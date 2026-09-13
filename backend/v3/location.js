'use strict';
/* V3 map engine + location service (Phases 1-4, V3 §15-24).
   Provider abstraction: MAP_PROVIDER=osm (default, free-compatible; Leaflet/OSM +
   Nominatim) or google (optional, requires VITE_GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_API_KEY).
   Provider failure NEVER crashes business logic (V3 §53). */

const crypto = require('node:crypto');
const { now } = require('./schema');
const { audit } = require('./core');

let db = null;
function setDb(d) { db = d; }

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const GOOGLE_GEO = 'https://maps.googleapis.com/maps/api/geocode/json';

function provider() {
  const p = String(process.env.MAP_PROVIDER || 'osm').toLowerCase();
  return p === 'google' && process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm';
}
async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GetInRoute/1.0' } });
    if (!res.ok) throw new Error('provider http ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

const SEARCH_CACHE = new Map(); // debounce/cache layer; throttling handled by callers
function cached(key, fn) {
  if (SEARCH_CACHE.has(key)) return Promise.resolve(SEARCH_CACHE.get(key).v);
  return fn().then((v) => { SEARCH_CACHE.set(key, { v, t: Date.now() }); if (SEARCH_CACHE.size > 500) SEARCH_CACHE.clear(); return v; });
}

/* search autocomplete (debounce + min chars handled by UI; server enforces min 2) */
function normalize(r) {
  return {
    formatted_address: r.formatted_address || r.display_name || r.label || '',
    latitude: parseFloat(r.lat ?? r.geometry?.location?.lat),
    longitude: parseFloat(r.lon ?? r.geometry?.location?.lng),
    provider: provider(),
    provider_reference: r.place_id != null ? String(r.place_id) : (r.reference || null),
    components: r.address_components || null
  };
}
async function search(q) {
  q = String(q || '').trim();
  if (q.length < 2) return { results: [], provider: provider(), detail: 'min_query_length' };
  return cached('s:' + provider() + ':' + q.toLowerCase(), async () => {
    if (provider() === 'google') {
      const url = `${GOOGLE_GEO}?address=${encodeURIComponent(q)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const j = await fetchJson(url);
      if (j.status !== 'OK') return { results: [], provider: 'google', detail: j.status };
      return { results: (j.results || []).slice(0, 6).map(normalize), provider: 'google', detail: 'ok' };
    }
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`;
    const j = await fetchJson(url);
    return { results: (Array.isArray(j) ? j : []).map(normalize), provider: 'osm', detail: 'ok' };
  });
}

async function reverse(lat, lng) {
  const la = Number(lat); const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) throw new Error('Invalid coordinates for reverse geocode');
  const key = `r:${provider()}:${la.toFixed(5)},${ln.toFixed(5)}`;
  return cached(key, async () => {
    if (provider() === 'google') {
      const url = `${GOOGLE_GEO}?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const j = await fetchJson(url);
      if (j.status !== 'OK') return { result: null, provider: 'google' };
      return { result: normalize(j.results[0]), provider: 'google' };
    }
    const url = `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=auto`;
    const j = await fetchJson(url);
    return { result: normalize(j), provider: 'osm' };
  });
}

/* routing distance/duration (V3 §18 route editor). Returns estimates clearly
   labelled. Providers that need keys gracefully fall back to a straight-line
   heuristic labelled "estimate". */
async function routeDistance(origin, dest) {
  const [o, d] = [origin, dest];
  const haversineKm = (a, b) => {
    const R = 6371; const dLat = (b.latitude - a.latitude) * Math.PI / 180;
    const dLon = (b.longitude - a.longitude) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  try {
    if (provider() === 'google' && process.env.GOOGLE_MAPS_API_KEY) {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${o.latitude},${o.longitude}&destinations=${d.latitude},${d.longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const j = await fetchJson(url);
      const el = j.rows?.[0]?.elements?.[0];
      if (el && el.status === 'OK') {
        return { distance_km: el.distance?.value / 1000, duration_min: el.duration?.value / 60, provider: 'google', is_estimate: false };
      }
    }
    const km = haversineKm(o, d);
    return { distance_km: +km.toFixed(2), duration_min: +((km / 30) * 60).toFixed(1), provider: 'heuristic', is_estimate: true };
  } catch (e) {
    const km = haversineKm(o, d);
    return { distance_km: +km.toFixed(2), duration_min: +((km / 30) * 60).toFixed(1), provider: 'heuristic', is_estimate: true, fallback: true };
  }
}

/* ---------------- ADDRESS STORE (V3 §19-24) ---------------- */
// Old users.home_*/pending_* columns are frozen; new address rows are additive.
function saveAddress({ ownerType, ownerId, address, userId }) {
  if (!address) return null;
  if (ownerType && ownerId != null) {
    db.prepare('UPDATE addresses SET is_current = 0 WHERE owner_type = ? AND owner_id = ?').run(ownerType, ownerId);
  }
  const ins = db.prepare(`INSERT INTO addresses
    (owner_type, owner_id, address_line, landmark, locality, city, state, postal_code, country,
     latitude, longitude, formatted_address, provider_reference, accuracy, source, is_current, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
  const comp = address.components || {};
  const c = (f) => { const x = (comp.f || []).length ? comp.f[0].long_name : null; return x; };
  const r = ins.run(ownerType || null, ownerId != null ? ownerId : null,
    address.address_line || null, address.landmark || null,
    address.locality || c('locality') || null,
    address.city || c('administrative_area_level_2') || c('administrative_area_level_1') || null,
    address.state || c('administrative_area_level_1') || null,
    address.postal_code || c('postal_code') || null,
    address.country || c('country') || null,
    Number.isFinite(Number(address.latitude)) ? Number(address.latitude) : null,
    Number.isFinite(Number(address.longitude)) ? Number(address.longitude) : null,
    address.formatted_address || null, address.provider_reference || null,
    address.accuracy || null, address.source || 'manual', now(), now());
  const id = db.prepare('SELECT last_insert_rowid() AS id').get().id != null ? db.prepare('SELECT last_insert_rowid() AS id').get().id : r.lastInsertRowid;
  if (userId) saveRecent(userId, address);
  return id;
}
function saveRecent(userId, address) {
  try {
    db.prepare('INSERT INTO recent_locations (user_id, formatted_address, latitude, longitude, source, used_at) VALUES (?,?,?,?,?,?)')
      .run(userId, address.formatted_address || null,
        Number.isFinite(Number(address.latitude)) ? Number(address.latitude) : null,
        Number.isFinite(Number(address.longitude)) ? Number(address.longitude) : null,
        address.source || 'manual', now());
    db.prepare('DELETE FROM recent_locations WHERE user_id = ? AND id NOT IN (SELECT id FROM recent_locations WHERE user_id = ? ORDER BY used_at DESC LIMIT 25)').run(userId, userId);
  } catch (e) { /* non-critical */ }
}
function recentLocations(userId) {
  return db.prepare('SELECT * FROM recent_locations WHERE user_id = ? ORDER BY used_at DESC LIMIT 25').all(userId);
}
function latestAddress(ownerType, ownerId) {
  return db.prepare('SELECT * FROM addresses WHERE owner_type = ? AND owner_id = ? ORDER BY is_current DESC, id DESC LIMIT 1').get(ownerType, ownerId) || null;
}
/* Validation (V3 §67): reject impossible coordinates/obviously invalid input. */
function validateLocation(address) {
  const errs = [];
  if (address.latitude != null) {
    const la = Number(address.latitude);
    if (!Number.isFinite(la) || Math.abs(la) > 90) errs.push('Invalid latitude');
  }
  if (address.longitude != null) {
    const ln = Number(address.longitude);
    if (!Number.isFinite(ln) || Math.abs(ln) > 180) errs.push('Invalid longitude');
  }
  if (address.latitude == null && address.longitude == null && !address.formatted_address) errs.push('Missing coordinates and address');
  if (address.formatted_address && address.formatted_address.length > 500) errs.push('Address too long');
  return { ok: errs.length === 0, errors: errs, verified: !!address.formatted_address && address.latitude != null && address.longitude != null };
}

/* ---------------- ROUTE EDITOR helpers (V3 §18) ---------------- */
function validateRouteDraft(stops) {
  const errs = [];
  if (!Array.isArray(stops) || stops.length < 2) errs.push('Route needs at least 2 stops');
  const seen = new Set();
  for (const s of stops || []) {
    if (!s || !s.label) errs.push('Stop missing label');
    if (s.latitude == null || s.longitude == null) errs.push(`Stop "${s.label || '?'}" missing coordinates`);
    else if (!Number.isFinite(Number(s.latitude)) || !Number.isFinite(Number(s.longitude))) errs.push(`Stop "${s.label}" invalid coordinates`);
    const key = `${Number(s.latitude).toFixed(5)},${Number(s.longitude).toFixed(5)}`;
    if (seen.has(key)) errs.push(`Duplicate stop coordinates at "${s.label}"`);
    seen.add(key);
  }
  return { ok: errs.length === 0, errors: errs };
}

module.exports = { setDb, provider, search, reverse, routeDistance, saveAddress, saveRecent, recentLocations, latestAddress, validateLocation, validateRouteDraft };