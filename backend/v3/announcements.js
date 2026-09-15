'use strict';
/* Announcements — Admin-only publishing (Item 9).
   Admin creates/edits/deletes text+image announcements targeted at
   Employee App, Driver App or Both (plus School), with optional
   start/expiry windows. Consumers only ever see verified active rows
   scoped to their own company (multi-tenant safe). */

let _db = null;
function setDb(db) { _db = db; }
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const AUDIENCES = ['both', 'employee', 'driver', 'school'];

function normalize(body) {
  const b = body || {};
  const audience = (AUDIENCES.includes(String(b.audience || '').toLowerCase()) ? String(b.audience).toLowerCase() : 'both');
  const title = String(b.title || '').trim();
  if (!title) throw Object.assign(new Error('Title is required'), { status: 400 });
  const bodyText = String(b.body || '').slice(0, 4000);
  const imageUrl = String(b.image_url || '').trim().slice(0, 1000) || null;
  const starts_at = String(b.starts_at || '').slice(0, 19) || null;
  const expires_at = String(b.expires_at || '').slice(0, 19) || null;
  const enabled = b.enabled === false || b.enabled === 0 ? 0 : 1;
  return { audience, title, body: bodyText, image_url: imageUrl, starts_at, expires_at, enabled };
}

/* Effective-now check: an announcement is live when enabled and the current
   time is inside the [starts_at, expires_at] window (open-ended when unset). */
function isLive(row, at = null) {
  if (!row || row.enabled !== 1) return false;
  const t = at || now();
  if (row.starts_at && row.starts_at > t) return false;
  if (row.expires_at && row.expires_at < t) return false;
  return true;
}

/* Admin-facing list: all announcements (global + this company). */
function list({ companyId, role }) {
  const cid = companyId || null;
  return _db.prepare(`SELECT * FROM announcements WHERE ((? || '') IS NULL OR company_id = ?) ORDER BY enabled DESC, id DESC LIMIT 200`)
    .all(cid, cid).map((r) => ({ ...r, live: isLive(r) }));
}

/* App-facing list: only live, enabled, targeted at the caller's audience. */
function listForApp({ companyId, audience }) {
  const cid = companyId || null;
  const rows = _db.prepare(`SELECT * FROM announcements WHERE ((? || '') IS NULL OR company_id = ?) AND audience IN ('both', ?) AND enabled = 1 ORDER BY id DESC LIMIT 20`)
    .all(cid, cid, String(audience || '').toLowerCase());
  return rows.filter((r) => isLive(r)).map((r) => ({
    id: r.id, title: r.title, body: r.body, image_url: r.image_url, audience: r.audience,
    starts_at: r.starts_at, expires_at: r.expires_at, created_at: r.created_at
  }));
}

function upsert(body, actorId) {
  const v = normalize(body);
  if (body.id) {
    const old = _db.prepare('SELECT * FROM announcements WHERE id = ?').get(body.id);
    if (!old) throw Object.assign(new Error('Announcement not found'), { status: 404 });
    _db.prepare(`UPDATE announcements SET company_id = COALESCE(?, company_id), audience = ?, title = ?, body = ?, image_url = ?, starts_at = ?, expires_at = ?, enabled = ?, updated_at = ? WHERE id = ?`)
      .run(body.company_id != null ? Number(body.company_id) : old.company_id, v.audience, v.title, v.body, v.image_url, v.starts_at, v.expires_at, v.enabled, now(), old.id);
    return { ok: true, id: old.id, action: 'updated' };
  }
  const info = _db.prepare(`INSERT INTO announcements (company_id, audience, title, body, image_url, starts_at, expires_at, enabled, created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(body.company_id != null ? Number(body.company_id) : null, v.audience, v.title, v.body, v.image_url, v.starts_at, v.expires_at, v.enabled, actorId || null);
  return { ok: true, id: Number(info.lastInsertRowid), action: 'created' };
}

function remove(id, actorId) {
  const old = _db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!old) throw Object.assign(new Error('Announcement not found'), { status: 404 });
  _db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  return { ok: true, id };
}

module.exports = { setDb, list, listForApp, upsert, remove, isLive, AUDIENCES };