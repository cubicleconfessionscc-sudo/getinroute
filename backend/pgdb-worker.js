// PostgreSQL worker thread for GetInRoute.
//
// Owns exactly one pg.Client. The main thread blocks synchronously on a
// SharedArrayBuffer flag while this thread runs async queries, then wakes and
// pulls the reply synchronously via receiveMessageOnPort. This hands the app a
// db.prepare().run/get/all surface identical to node:sqlite.
//
// int8/int2/int4/numeric are parsed to JS numbers so PG results match the types
// SQLite produced (ids/counts as numbers, TEXT as strings, no Date objects).
'use strict';

const { parentPort, workerData } = require('worker_threads');
const { Client, types } = require('pg');

types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(21, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(23, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(701, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const flag = new Int32Array(workerData.flagBuf);
const replyPort = workerData.replyPort;
let client = null;

function done(reply) {
  replyPort.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

async function ensureConnected() {
  if (client) return;
  const { url, timezone } = workerData;
  client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    statement_timeout: 60000,
    query_timeout: 60000,
  });
  await client.connect();
  await client.query('SELECT set_config($1::text, $2::text, false)', ['app.time_zone', timezone]);
  await client.query('SELECT set_config($1::text, $2::text, false)', ['client_min_messages', 'warning']);
}

async function handle(req) {
  try {
    await ensureConnected();
    if (req.method === 'run') {
      const params = req.params || [];
      const r = await client.query({ text: req.sql, values: params });
      let lastInsertRowid = null;
      if (/^\s*(?:INSERT|REPLACE)/i.test(req.sql)) {
        try {
          const lv = await client.query('SELECT lastval()::bigint AS id');
          lastInsertRowid = lv.rows[0] ? lv.rows[0].id : null;
        } catch (err) {
          lastInsertRowid = null;
        }
      }
      return { changes: r.rowCount || 0, lastInsertRowid };
    }
    if (req.method === 'get') {
      const r = await client.query({ text: req.sql, values: req.params || [] });
      return r.rows.length ? r.rows[0] : undefined;
    }
    if (req.method === 'all') {
      const r = await client.query({ text: req.sql, values: req.params || [] });
      return r.rows;
    }
    if (req.method === 'exec') {
      const results = [];
      for (const st of req.statements || []) {
        const r = await client.query({ text: st.sql, values: st.params || [] });
        results.push({ changes: r.rowCount || 0 });
      }
      return { results };
    }
    if (req.method === 'ping') return { pong: true };
    if (req.method === 'close') {
      if (client) await client.end();
      return { closed: true };
    }
    return { error: { message: 'unknown method ' + req.method } };
  } catch (err) {
    return { error: { message: err && err.message ? String(err.message) : String(err) } };
  }
}

parentPort.on('message', (req) => {
  handle(req).then((result) => done({ id: req.id, result }));
});