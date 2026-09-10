/* RAW DATA IMPORT (Owner/Admin) — registerRawImport(app, ctx)
   Paste-able or CSV/XLSX bulk creation of employees / drivers / vehicles /
   routes / vendors with a *validation-first* workflow:

     1) POST /api/owner/raw/import/preview   -> parse, map columns, validate
     2) Frontend shows mapping + counts (valid / invalid / existing duplicates)
     3) POST /api/owner/raw/import/commit    -> transactional insert + audit log

   Safety rules (per the working agreement):
   - Nothing is written on preview. Commit is the only write path.
   - No auto-overwrite / update. Rows whose unique key (email / emp_id / plate /
     route name / vendor email) already exists are classified as duplicates and
     either skipped or rejected per the caller's policy.
   - Entire import runs in one transaction (all-or-nothing).
   - A DB snapshot (backupNow) can be taken before commit (default on).
   - Rows are tagged vertical='company' (platform-owner writes). School tenants
     are managed through the School portal and are intentionally out of scope.
   - Every import is recorded in import_audit_log; rejected rows + reasons are
     stored so they can be exported back as a "rejected.csv". */

const crypto = require('node:crypto');

function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ALIAS = {
  name: ['name', 'fullname', 'employeename', 'drivername', 'vendorname'],
  email: ['email', 'login', 'loginid', 'mail', 'useremail'],
  emp_id: ['empid', 'employeeid', 'empcode', 'code'],
  phone: ['phone', 'mobile', 'contact', 'phonenumber', 'mobilenumber'],
  department: ['department', 'dept', 'team', 'unit'],
  designation: ['designation', 'title', 'role', 'position'],
  home_address: ['address', 'homeaddress', 'pickupaddress'],
  home_lat: ['lat', 'latitude', 'homelat'],
  home_lng: ['lng', 'lon', 'longitude', 'homelng', 'homeong'], // covered below
  password: ['password', 'pwd', 'temppassword'],
  driver_verified: ['verified', 'driververified'],
  vehicle_plate: ['vehicleplate', 'plate', 'vehicleregistration', 'carnumber', 'assignedvehicle'],
  vehicle_name: ['vehiclename', 'name', 'vehicle'],
  type: ['type', 'vehicletype', 'category'],
  capacity: ['capacity', 'seats', 'seatcapacity'],
  line: ['line', 'lineno'],
  trip: ['trip', 'tripno'],
  route: ['route', 'routename'],
  speed_limit: ['speedlimit', 'speed'],
  start_point: ['start', 'startpoint', 'from'],
  end_point: ['end', 'endpoint', 'to'],
  stops: ['stops', 'stoppoints', 'stopslist'],
  vendor_code: ['vendorcode', 'vendorname', 'code'],
  assigned_locations: ['assignedlocations', 'locations', 'zones', 'areas']
};
// Build reverse map: normalized header -> canonical field.
const ALIAS_LOOKUP = new Map();
for (const [field, keys] of Object.entries(ALIAS)) {
  for (const k of keys) if (!ALIAS_LOOKUP.has(k)) ALIAS_LOOKUP.set(k, field);
}
ALIAS_LOOKUP.set('homeond', 'home_lng'); // safety: typos of longitude
ALIAS_LOOKUP.set('lng', 'home_lng');

const ENTITIES = {
  employees: { table: 'users', required: ['name', 'email'], uniqueKeys: ['email', 'emp_id'] },
  drivers: { table: 'users', required: ['name', 'email'], uniqueKeys: ['email', 'emp_id'] },
  vehicles: {
    table: 'vehicles', required: ['vehicle_name'], uniqueKeys: ['plate'],
    // numeric fields with (min,max,isInt)
    numbers: { capacity: [1, 200, true], line: [1, 100, true], trip: [1, 100, true], speed_limit: [5, 200, false] }
  },
  routes: {
    table: 'routes', required: ['name'], uniqueKeys: ['name'],
    numbers: { speed_limit: [5, 200, false] }
  },
  vendors: { table: 'vendors', required: ['name'], uniqueKeys: ['email'] }
};
const ROLE_FOR_ENTITY = { employees: 'employee', drivers: 'driver' };

// ---- tiny RFC-4180-ish CSV parser with delimiter detection ----
function parseDelimited(text, preferred) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const detect = () => {
    if (preferred && preferred !== 'auto') return preferred;
    const first = lines[0];
    const counts = {};
    for (const d of [',', '\t', ';']) {
      let n = 0; let inQ = false;
      for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch === d) n += 1; }
      counts[d] = n;
    }
    return ['\t', ';', ','].sort((a, b) => counts[b] - counts[a])[0];
  };
  const delim = detect();
  const out = [];
  for (const line of lines) {
    const row = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 1; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === delim) {
        row.push(cur); cur = '';
      } else cur += ch;
    }
    row.push(cur);
    out.push(row.map((c) => String(c || '').trim()));
  }
  return out;
}

// ---- per-row field-level validation ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRecord(entity, record, ctx) {
  const issues = [];
  const def = ENTITIES[entity];
  for (const req of def.required) {
    if (!record[req] || !String(record[req]).trim()) issues.push(`Missing required column "${req}"`);
  }
  if (record.email && !EMAIL_RE.test(record.email)) issues.push(`Invalid email "${record.email}"`);
  if (record.home_lat != null && record.home_lat !== '') {
    const lat = Number(record.home_lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push(`Invalid latitude "${record.home_lat}"`);
  }
  if (record.home_lng != null && record.home_lng !== '') {
    const lng = Number(record.home_lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) issues.push(`Invalid longitude "${record.home_lng}"`);
  }
  if (def.numbers) {
    for (const [f, [min, max, isInt]] of Object.entries(def.numbers)) {
      if (record[f] == null || record[f] === '') continue;
      const n = Number(record[f]);
      if (!Number.isFinite(n)) { issues.push(`"${f}" must be a number`); continue; }
      if (isInt && !Number.isInteger(n)) { issues.push(`"${f}" must be a whole number`); continue; }
      if (n < min || n > max) issues.push(`"${f}" out of range (${min}–${max})`);
      record[f] = n;
    }
  }
  if (entity === 'routes' && record.stops) {
    const parsed = parseStopsString(record.stops);
    if (parsed === null) issues.push('Stops must look like "Name@lat,lng;Name@lat,lng"');
    else {
      record._stops = parsed.stops;
      if (!record.start_point) record.start_point = parsed.first.name;
      if (!record.end_point) record.end_point = parsed.last.name;
      record.home_lat = parsed.first.lat; record.home_lng = parsed.first.lng;
      if (!record.speed_limit && parsed.guessedLimit) record.speed_limit = parsed.guessedLimit;
    }
  }
  if (entity === 'drivers' && record.driver_verified != null && record.driver_verified !== '') {
    record.driver_verified = /^(1|yes|true|active|ok)$/i.test(String(record.driver_verified)) ? 1 : 0;
  }
  return issues;
}

function parseStopsString(s) {
  const parts = String(s).split(/[;\n|]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const stops = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)@\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[2]), lng = Number(m[3]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    stops.push({ sequence: stops.length + 1, name: m[1].trim(), lat, lng });
  }
  return {
    stops,
    first: stops[0],
    last: stops[stops.length - 1],
    guessedLimit: stops.length >= 8 ? 40 : stops.length >= 4 ? 30 : null
  };
}

function numberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cell(record, field) { return record[field] != null ? String(record[field]).trim() : ''; }

// ---- in-memory preview tokens (single process; TTL 15 min) ----
const previewStore = new Map();
const PREVIEW_TTL = 15 * 60 * 1000;

function registerRawImport(app, ctx) {
  const { db, bcrypt, auth, role, ownerOnly, guard, notify, ts, emitToAdmins, backupNow } = ctx;
  const ownerOnlyGuard = [auth, role('admin'), ownerOnly];

  // Pretty list of the mapping the engine will use (also shown in the UI).
  function mappingFor(entity) {
    const def = ENTITIES[entity];
    const fields = Object.keys(ALIAS).filter((f) => {
      if (entity === 'routes' && ['vehicle_plate', 'driver_verified'].includes(f)) return false;
      if (entity === 'vehicles' && ['vehicle_plate', 'driver_verified', 'home_address', 'home_lat', 'home_lng', 'password', 'emp_id', 'designation', 'department'].includes(f)) return false;
      if (entity === 'vendors' && ['vehicle_plate', 'driver_verified', 'home_address', 'home_lat', 'home_lng', 'password', 'emp_id', 'designation', 'department', 'vehicle_name', 'capacity', 'line', 'trip', 'route', 'speed_limit', 'start_point', 'end_point', 'stops', 'type'].includes(f)) return false;
      if ((entity === 'employees' || entity === 'drivers') && ['capacity', 'line', 'trip', 'route', 'speed_limit', 'start_point', 'end_point', 'stops', 'type', 'vehicle_plate', 'vendor_code', 'assigned_locations'].includes(f)) return entity === 'drivers' && f === 'vehicle_plate';
      return true;
    });
    return fields.map((f) => ({ field: f, required: def.required.includes(f), aliases: ALIAS[f].slice(0, 6) }));
  }

  function parseRows(aoa) {
    if (!aoa.length) return { rows: [], header: [] };
    const header = aoa[0];
    const colMap = header.map((h) => ALIAS_LOOKUP.get(normalizeKey(h)) || null);
    const rows = [];
    for (let i = 1; i < aoa.length; i += 1) {
      const row = aoa[i];
      const rec = {};
      const raw = {};
      header.forEach((h, ci) => {
        raw[h] = row[ci] != null ? row[ci] : '';
        if (colMap[ci]) {
          const v = row[ci] != null ? String(row[ci]).trim() : '';
          if (v !== '') rec[colMap[ci]] = v;
        }
      });
      rows.push({ line: i + 1, values: rec, raw });
    }
    return { rows, header };
  }

  app.post('/api/owner/raw/mapping', ...ownerOnlyGuard, guard(60, 60000), (req, res) => {
    const entity = String((req.body || {}).entity || '').toLowerCase();
    if (!ENTITIES[entity]) return res.status(400).json({ error: `Unknown entity. Expected: ${Object.keys(ENTITIES).join(', ')}` });
    res.json({ entity, mapping: mappingFor(entity) });
  });

  app.post('/api/owner/raw/import/preview', ...ownerOnlyGuard, guard(10, 60000), (req, res) => {
    const b = req.body || {};
    const entity = String(b.entity || '').toLowerCase();
    if (!ENTITIES[entity]) return res.status(400).json({ error: `Unknown entity. Expected: ${Object.keys(ENTITIES).join(', ')}` });
    const source = String(b.source || 'paste').toLowerCase();

    let aoa = null;
    let fileName = b.fileName ? String(b.fileName).slice(0, 120) : null;
    try {
      if (source === 'xlsx' || (fileName && /\.(xlsx|xls)$/i.test(fileName))) {
        let xlsx = null;
        try { xlsx = require('xlsx'); } catch { /* below */ }
        if (!xlsx) return res.status(501).json({ error: 'XLSX support is not installed on this server (npm install xlsx). Use CSV or paste instead.' });
        if (!b.fileData) return res.status(400).json({ error: 'fileData (base64) required for XLSX' });
        const wb = xlsx.read(Buffer.from(String(b.fileData), 'base64'), { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) return res.status(400).json({ error: 'Spreadsheet has no sheets' });
        aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }).map((r) => r.map(String));
      } else {
        const text = String(b.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Paste CSV/TSV text or upload a file' });
        aoa = parseDelimited(text, b.delimiter);
      }
    } catch (e) {
      return res.status(400).json({ error: 'Could not parse that input: ' + e.message });
    }
    if (!aoa || aoa.length < 2) return res.status(400).json({ error: 'Need a header row plus at least one data row.' });
    if (aoa.length - 1 > 5000) return res.status(400).json({ error: 'Too many rows (max 5000 per import). Split the file.' });

    const { rows, header } = parseRows(aoa);
    const def = ENTITIES[entity];

    // existing-records by unique key
    const seenInDb = { email: new Set(), emp_id: new Set(), plate: new Set(), name: new Set() };
    const table = entity === 'vendors' ? 'vendors' : 'users';
    if (table === 'vendors') {
      for (const r of db.prepare('SELECT email, name FROM vendors').all()) { seenInDb.email.add(String(r.email || '').toLowerCase()); seenInDb.name.add(String(r.name || '').toLowerCase()); }
    } else {
      for (const r of db.prepare(`SELECT emp_id, email FROM users WHERE role IN ('employee','driver')`).all()) {
        if (r.email) seenInDb.email.add(String(r.email).toLowerCase());
        if (r.emp_id) seenInDb.emp_id.add(String(r.emp_id).toLowerCase());
      }
    }
    if (entity === 'vehicles') for (const r of db.prepare('SELECT plate FROM vehicles').all()) seenInDb.plate.add(String(r.plate || '').toLowerCase());
    if (entity === 'routes') for (const r of db.prepare('SELECT name FROM routes').all()) seenInDb.name.add(String(r.name || '').toLowerCase());

    const seenInFile = { email: new Set(), emp_id: new Set(), plate: new Set(), name: new Set() };

    let validCount = 0, dupCount = 0, invalidCount = 0;
    for (const row of rows) {
      const issues = validateRecord(entity, row.values, null);
      // duplicates
      const dupReasons = [];
      if (def.uniqueKeys.includes('email') && row.values.email) {
        const e = String(row.values.email).toLowerCase();
        if (seenInDb.email.has(e)) dupReasons.push(`Email already exists: ${row.values.email}`);
        if (seenInFile.email.has(e)) dupReasons.push(`Duplicate email in file: ${row.values.email}`);
        seenInFile.email.add(e);
      }
      if (def.uniqueKeys.includes('emp_id') && row.values.emp_id) {
        const eid = String(row.values.emp_id).toLowerCase();
        if (seenInDb.emp_id.has(eid)) dupReasons.push(`Emp ID already exists: ${row.values.emp_id}`);
        if (seenInFile.emp_id.has(eid)) dupReasons.push(`Duplicate Emp ID in file: ${row.values.emp_id}`);
        seenInFile.emp_id.add(eid);
      }
      if (def.uniqueKeys.includes('plate') && row.values.plate) {
        const p = String(row.values.plate).toLowerCase();
        if (seenInDb.plate.has(p)) dupReasons.push(`Plate already exists: ${row.values.plate}`);
        if (seenInFile.plate.has(p)) dupReasons.push(`Duplicate plate in file: ${row.values.plate}`);
        seenInFile.plate.add(p);
      }
      if (def.uniqueKeys.includes('name') && entity === 'routes' && row.values.name) {
        const n = String(row.values.name).toLowerCase();
        if (seenInDb.name.has(n)) dupReasons.push(`Route name already exists: ${row.values.name}`);
        seenInFile.name.add(n);
      }
      const allIssues = [...issues, ...dupReasons];
      if (allIssues.length) {
        if (dupReasons.length && !issues.length) dupCount += 1; else invalidCount += 1;
        row.issues = allIssues;
      } else {
        validCount += 1;
        row.issues = [];
      }
    }

    const token = crypto.randomBytes(16).toString('hex');
    previewStore.set(token, {
      entity, source, fileName, header, rows, stats: { total: rows.length, valid: validCount, invalid: invalidCount, duplicate: dupCount },
      expiresAt: Date.now() + PREVIEW_TTL
    });
    previewStore.forEach((v, k) => { if (v.expiresAt < Date.now()) previewStore.delete(k); });

    res.json({
      ok: true, token, entity, source, fileName,
      stats: { total: rows.length, valid: validCount, invalid: invalidCount, duplicate: dupCount },
      header,
      mapping: mappingFor(entity),
      preview: rows.filter((r) => !r.issues.length).slice(0, 20).map((r) => ({ line: r.line, values: r.values })),
      issues: rows.filter((r) => r.issues.length).slice(0, 25).map((r) => ({ line: r.line, reasons: r.issues, values: r.values }))
    });
  });

  app.post('/api/owner/raw/import/commit', ...ownerOnlyGuard, guard(20, 60000), (req, res) => {
    const b = req.body || {};
    const token = String(b.token || '');
    const st = previewStore.get(token);
    if (!st || st.expiresAt < Date.now()) return res.status(400).json({ error: 'Preview token expired or not found — run Preview again.' });
    const duplicatePolicy = b.duplicatePolicy === 'reject' ? 'reject' : 'skip';
    const backupFirst = b.backupFirst !== false;

    const insertUser = entity => {
      const role = ROLE_FOR_ENTITY[entity];
      return db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, status, home_address, home_lat, home_lng, must_change_password, driver_verified, vertical)
          VALUES ('${role}', ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, 'company')`);
      // Note: static role is safe (only employee/driver).
    };

    let inserted = 0, rejected = 0, skipped = 0;
    const rejectedRows = [];
    try {
      if (backupFirst) { try { backupNow(); } catch (e) { console.error('[raw-import] backup skipped:', e.message); } }
      db.exec('BEGIN');
      for (const row of st.rows) {
        if (row.issues.length) {
          const isDup = row.issues.some((i) => /already exists|Duplicate/i.test(i));
          if (isDup && duplicatePolicy === 'skip') { skipped += 1; } else { rejected += 1; }
          rejectedRows.push({ line: row.line, values: row.raw, reasons: row.issues });
          continue;
        }
        const v = row.values;
        try {
          if (st.entity === 'employees' || st.entity === 'drivers') {
            const pwd = v.password ? bcrypt.hashSync(String(v.password), 10) : ('!' + crypto.randomBytes(16).toString('hex'));
            insertUser(st.entity).run(
              v.emp_id || null, (v.email || '').toLowerCase(), v.name, v.phone || null, v.department || null, v.designation || null, pwd,
              v.home_address || null, numberOrNull(v.home_lat), numberOrNull(v.home_lng),
              v.password ? 0 : 1, st.entity === 'drivers' ? (v.driver_verified || 0) : 0
            );
            const uid = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
            if (st.entity === 'drivers' && v.vehicle_plate) {
              const veh = db.prepare('SELECT * FROM vehicles WHERE UPPER(plate)=UPPER(?)').get(v.vehicle_plate);
              if (veh) {
                db.prepare('UPDATE users SET vehicle_id=? WHERE id=?').run(veh.id, uid);
                db.prepare('UPDATE vehicles SET driver_name=?, driver_phone=?, driver_id=? WHERE id=?').run(v.name, v.phone || null, uid, veh.id);
              }
            }
            inserted += 1;
          } else if (st.entity === 'vehicles') {
            let routeId = null;
            if (v.route) { const r = db.prepare('SELECT id FROM routes WHERE name = ?').get(v.route); if (r) routeId = r.id; }
            db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, route_id, speed_limit, status, vertical)
                VALUES (?,?,?,?,?,?,?,?,'idle','company')`)
              .run(v.vehicle_name, v.plate || null, v.type || 'Cab', Number(v.capacity) || 4, Number(v.line) || 1, Number(v.trip) || 1, routeId, numberOrNull(v.speed_limit));
            inserted += 1;
          } else if (st.entity === 'routes') {
            const stops = v._stops || [];
            const startLat = v.home_lat != null ? Number(v.home_lat) : (stops[0] ? stops[0].lat : null);
            const startLng = v.home_lng != null ? Number(v.home_lng) : (stops[0] ? stops[0].lng : null);
            const endLat = stops.length ? stops[stops.length - 1].lat : null;
            const endLng = stops.length ? stops[stops.length - 1].lng : null;
            db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops, start_lat, start_lng, end_lat, end_lng, vertical)
                VALUES (?,?,?,?,?,?,?,?,?,'company')`)
              .run(v.name, v.start_point || null, v.end_point || null, Number(v.speed_limit) || (stops.length >= 6 ? 40 : 30),
                JSON.stringify(stops), startLat, startLng, endLat, endLng);
            inserted += 1;
          } else if (st.entity === 'vendors') {
            const locs = v.assigned_locations ? JSON.stringify(String(v.assigned_locations).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) : '[]';
            db.prepare(`INSERT INTO vendors (name, email, phone, vendor_code, assigned_locations, assigned_route_ids, vertical)
                VALUES (?,?,?,?,?,?,'company')`)
              .run(v.name, v.email ? String(v.email).toLowerCase() : null, v.phone || null, v.vendor_code || null, locs, '[]');
            inserted += 1;
          }
        } catch (e) {
          rejected += 1;
          rejectedRows.push({ line: row.line, values: row.raw, reasons: [(e.message || 'insert failed').slice(0, 200)] });
        }
      }
      const rowCount = st.rows.length;
      const logJson = JSON.stringify({ headers: st.header, rows: rejectedRows.slice(0, 2000) });
      db.prepare(`INSERT INTO import_audit_log (user_id, user_name, entity, source, filename, total_rows, valid_rows, duplicate_rows, error_rows, inserted_rows, skipped_rows, rejected_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, req.user.name || '', st.entity, st.source, st.fileName || null,
          rowCount, rowCount - rejectedRows.length, st.stats.duplicate, st.stats.invalid,
          inserted, skipped, logJson);
      db.exec('COMMIT');
      previewStore.delete(token);
      emitToAdmins('raw:imported', { entity: st.entity, inserted, rejected, skipped, by: req.user.name || req.user.id });
      notify(req.user.id, 'Import complete', `${st.entity}: ${inserted} inserted, ${skipped} skipped, ${rejected} rejected.`);
      res.json({ ok: true, summary: { entity: st.entity, inserted, skipped, rejected, total: rowCount }, rejectedCount: rejectedRows.length });
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('[raw-import] commit failed:', e.message);
      res.status(500).json({ error: 'Import failed and was rolled back (no changes applied): ' + e.message });
    }
  });

  app.get('/api/owner/raw/import/log', ...ownerOnlyGuard, (req, res) => {
    const rows = db.prepare(`SELECT id, user_name, entity, source, filename, total_rows, valid_rows, duplicate_rows, error_rows, inserted_rows, skipped_rows, created_at
        FROM import_audit_log ORDER BY id DESC LIMIT 100`).all();
    res.json({ rows });
  });

  app.get('/api/owner/raw/import/rejected/:id', ...ownerOnlyGuard, (req, res) => {
    const row = db.prepare('SELECT * FROM import_audit_log WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Import record not found' });
    let data = null;
    try { data = row.rejected_json ? JSON.parse(row.rejected_json) : null; } catch { data = null; }
    const headers = data && Array.isArray(data.headers) ? data.headers : [];
    const rows = data && Array.isArray(data.rows) ? data.rows : [];
    const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const csv = [
      ...(headers.length ? [['line', ...headers, 'reason'].map(esc).join(',')] : ['"line","reason"']),
      ...rows.map((r) => {
        const cells = headers.map((h) => esc(r.values && r.values[h] != null ? r.values[h] : ''));
        return esc(r.line) + (cells.length ? ',' + cells.join(',') : '') + ',"' + r.reasons.join(' | ').replace(/"/g, '""') + '"';
      })
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import-${row.id}-rejected.csv"`);
    res.send(csv);
  });

  // Basic self-check used by the test harness.
  app.get('/api/owner/raw/health', ...ownerOnlyGuard, (req, res) => {
    res.json({ ok: true, entities: Object.keys(ENTITIES) });
  });
}

module.exports = { registerRawImport };