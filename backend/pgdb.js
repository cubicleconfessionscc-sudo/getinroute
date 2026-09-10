// PostgreSQL adapter for GetInRoute (production mode).
//
// Drop-in replacement for node:sqlite's DatabaseSync surface, but backed by
// PostgreSQL through the pgdb-worker thread. Activated when DATABASE_URL is set.
//
// Responsibilities:
//  - mirror db.prepare(sql).run/get/all(...) semantics
//  - deterministically translate the SQLite SQL dialect used across db.js and
//    server.js (datetime/date/time helpers, INSERT OR IGNORE, last_insert_rowid,
//    ? placeholders, PRAGMA no-ops) into equivalent PostgreSQL SQL
//  - sync bridge: blocking calls with results delivered synchronously via a
//    SharedArrayBuffer flag + receiveMessageOnPort
'use strict';

const { Worker, receiveMessageOnPort, MessageChannel } = require('worker_threads');

const DEFAULT_TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

let worker = null;
let flag = null;
let replyPort = null;
let nextId = 1;
let timezone = DEFAULT_TZ;

const CACHE = new Map();

function sleepSync(ms) {
  const b = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(b, 0, 0, ms);
}

function ensureWorker() {
  if (worker) return;
  const sab = new SharedArrayBuffer(4);
  flag = new Int32Array(sab);
  Atomics.store(flag, 0, 0);
  const { port1, port2 } = new MessageChannel();
  worker = new Worker(require.resolve('./pgdb-worker.js'), {
    workerData: { flagBuf: sab, timezone, url: process.env.DATABASE_URL, replyPort: port2 },
    transferList: [port2],
  });
  replyPort = port1;
  worker.unref();
}

// Blocking round-trip to the worker thread.
function call(method, payload, timeoutMs) {
  ensureWorker();
  const id = nextId++;
  Atomics.store(flag, 0, 0);
  worker.postMessage({ id, method, ...(payload || {}) });
  const timeout = timeoutMs || 60000;
  const deadline = Date.now() + timeout;
  while (true) {
    const wret = Atomics.wait(flag, 0, 0, 1000);
    if (wret === 'ok' || wret === 'not-equal') {
      const reply = receiveMessageOnPort(replyPort);
      if (reply && reply.message && reply.message.id === id) {
        const res = reply.message.result;
        if (res && res.error) {
          const e = new Error(res.error.message);
          e.errno = 'PG';
          throw e;
        }
        return res;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error('PostgreSQL call timed out: ' + method);
    }
  }
}

function setAppTimezone(tz) {
  if (tz && typeof tz === 'string' && tz.trim()) timezone = tz.trim();
}

// ---- SQLite -> PostgreSQL SQL translation --------------------------------
// Applied to every statement in PG mode. Order matters.
function rewriteNamedParams(sql, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { sql, values: params || [] };
  const out = [];
  let idx = 1;
  const seen = new Map();
  let i = 0;
  let last = 0;
  const re = /@[A-Za-z_][A-Za-z0-9_]*/g;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const key = match[0].slice(1);
    let n = seen.get(key);
    if (!n) {
      n = idx++;
      seen.set(key, n);
    }
    out.push(sql.slice(last, match.index));
    out.push('$' + n);
    last = match.index + match[0].length;
  }
  if (!out.length) return { sql, values: [] };
  out.push(sql.slice(last));
  const values = [];
  for (const key of seen.keys()) {
    if (!(key in params)) throw new Error('Missing named parameter: @' + key);
    values.push(params[key]);
  }
  return { sql: out.join(''), values };
}

function rewritePositionalParams(sql, values) {
  const parts = [];
  let i = 0;
  let last = 0;
  let n = 0;
  let quote = null;
  let dollar = false;
  while (i < sql.length) {
    const c = sql[i];
    if (dollar) {
      if (c === '$' && sql[i + 1] === '$') {
        dollar = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (c === '$' && sql[i + 1] === '$') {
      dollar = true;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '?') {
      n++;
      parts.push(sql.slice(last, i));
      parts.push('$' + n);
      last = i + 1;
    }
    i++;
  }
  if (!n) return { sql, values: values || [] };
  parts.push(sql.slice(last));
  return { sql: parts.join(''), values: values || [] };
}

function translateDateDialect(sql) {
  let out = sql;
  out = out.replace(/datetime\('now','localtime',\s*\?\)/g, "to_char((now() AT TIME ZONE app_tz()) + (?)::interval, 'YYYY-MM-DD HH24:MI:SS')");
  out = out.replace(/datetime\('now','localtime'\)/g, 'log_now()');
  out = out.replace(/datetime\('now'\)/g, 'log_now()');
  out = out.replace(/date\('now','localtime',\s*'-(\d+)\s+(days?)'\)/g, "to_char((now() AT TIME ZONE app_tz()) - interval '$1 $2', 'YYYY-MM-DD')");
  out = out.replace(/date\('now','localtime'\)/g, 'log_today()');
  out = out.replace(/date\('now'\)/g, 'log_today()');
  out = out.replace(/\bdate\(([A-Za-z_][A-Za-z0-9_]*\.\w+)\)/g, 'left($1, 10)');
  out = out.replace(/\bdate\(([A-Za-z_][A-Za-z0-9_]*)\)/g, 'left($1, 10)');
  out = out.replace(/time\('now','localtime'\)/g, "(now() AT TIME ZONE app_tz())::time");
  out = out.replace(/\btime\(([^()]*)\)/g, '(($1)::time)');
  out = out.replace(/\blast_insert_rowid\(\)/g, 'lastval()::bigint');
  return out;
}

// Returns { kind:'sql', sql, values } or { kind:'pragma' }.
function preparePGLite(sql, params) {
  const t = (sql || '').trim();
  if (/^PRAGMA\b/i.test(t)) return { kind: 'pragma' };
  if (/^VACUUM\b/i.test(t)) throw new Error('VACUUM is not supported in PostgreSQL mode');
  if (/^ATTACH\b/i.test(t)) throw new Error('ATTACH DATABASE is not supported in PostgreSQL mode');

  let out = sql;
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
  }
  out = translateDateDialect(out);

  let values;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const r = rewriteNamedParams(out, params);
    out = r.sql;
    values = r.values;
  } else {
    values = params || [];
  }
  const r = rewritePositionalParams(out, values);
  return { kind: 'sql', sql: r.sql, values: r.values };
}

const db_pg = {
  timezone,
  _isPg: true,
  setAppTimezone,
  close() {
    if (worker) {
      try {
        call('close', {}, 5000);
      } catch (err) {}
      try {
        worker.terminate();
      } catch (err) {}
      worker = null;
      flag = null;
    }
  },
  prepare(sql) {
    const key = String(sql);
    let stmt = CACHE.get(key);
    if (!stmt) {
      stmt = new PgStatement(key);
      CACHE.set(key, stmt);
    }
    return stmt;
  },
  exec(sql) {
    if (Array.isArray(sql)) {
      for (const s of sql) {
        if (!s) continue;
        const pw = preparePGLite(s, []);
        if (pw.kind === 'pragma') continue;
        call('run', { sql: pw.sql, params: pw.values }, 120000);
      }
      return true;
    }
    for (const s of splitStatements(sql)) {
      if (!s || !s.trim()) continue;
      const pw = preparePGLite(s, []);
      if (pw.kind === 'pragma') continue;
      call('run', { sql: pw.sql, params: pw.values }, 120000);
    }
    return true;
  },
};

class PgStatement {
  constructor(sql) {
    this.sourceSQL = sql;
  }
  _to(method, args) {
    const params = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? args[0]
      : [].concat(args);
    const pw = preparePGLite(this.sourceSQL, params);
    if (pw.kind === 'pragma') {
      return method === 'run' ? { changes: 0, lastInsertRowid: 0 } : undefined;
    }
    const res = call(method, { sql: pw.sql, params: pw.values });
    if (method === 'run') {
      return { changes: (res && res.changes) || 0, lastInsertRowid: (res && res.lastInsertRowid) || 0 };
    }
    return res;
  }
  run(...args) {
    return this._to('run', args);
  }
  get(...args) {
    return this._to('get', args);
  }
  all(...args) {
    const res = this._to('all', args);
    return res || [];
  }
}

// Split a multi-statement string on ';' outside string/dollar quotes.
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let quote = null;
  let dollar = false;
  while (i < sql.length) {
    const c = sql[i];
    if (dollar) {
      if (c === '$' && sql[i + 1] === '$') {
        dollar = false;
        cur += '$$';
        i += 2;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (sql[i + 1] === quote) {
          cur += c + c;
          i += 2;
          continue;
        }
        quote = null;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '$' && sql[i + 1] === '$') {
      dollar = true;
      cur += '$$';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      cur += c;
      i++;
      continue;
    }
    if (c === ';') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

module.exports = db_pg;