/* GetInRoute Geo Provider Layer
   Geocoding:  Photon (komoot) – free, no key, OSM-derived data
   Routing:    OSRM public demo – free, no key, with server-side cache
   Both configurable via env vars for future replacement.

   Responses are cached in PostgreSQL/SQLite (geo_route_cache and
   geo_result_cache tables) so identical requests never hit the provider twice. */

const db = require('./db');

const GEOCODER_BASE = process.env.GEOCODER_URL || 'https://photon.komoot.io';
const ROUTING_BASE = process.env.ROUTING_URL || 'https://router.project-osrm.org';
// Google Maps is used ONLY for routing/address services (Admin/Vendor route
// planning). The dashboard + live-tracking maps stay on MapLibre/OSM. When no
// key is configured we transparently use the free Photon/OSRM providers above.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MEM_MAX = 400;

/* Google is only tried while it still looks usable. A referrer-restricted key,
   disabled billing, or a disabled API comes back as REQUEST_DENIED / a billing
   error on EVERY call — so the first such failure flips a circuit for the
   process lifetime and every later request goes straight to the free
   Photon/OSRM provider. This keeps /api/geo/* fast and makes the provider
   reported by /api/config/public the one actually being used. */
const googleHealth = { geocode: true, routing: true };
function isGoogleAuthFailure(e) {
  const msg = String((e && e.message) || e || '');
  return /REQUEST_DENIED|BillingNotEnabled|must enable Billing|API keys with referer restrictions/i.test(msg);
}
function effectiveProviders() {
  return {
    geocoding: (GOOGLE_KEY && googleHealth.geocode) ? 'google' : (process.env.GEOCODING_PROVIDER || 'photon'),
    routing: (GOOGLE_KEY && googleHealth.routing) ? 'google' : (process.env.ROUTING_PROVIDER || 'osrm')
  };
}

/* ---------- Google providers (used when GOOGLE_MAPS_API_KEY is set) ---------- */
function gComp(components, type) {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  return c ? c.long_name : '';
}
function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const out = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
async function googleGeocodeSearch(query, { limit = 8 } = {}) {
  const params = new URLSearchParams({ address: String(query).trim(), key: GOOGLE_KEY });
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Google geocode ${r.status}`);
  const data = await r.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Google geocode ${data.status}${data.error_message ? `: ${data.error_message}` : ''}`);
  }
  return (data.results || []).slice(0, limit).map((x) => ({
    label: x.formatted_address,
    address: x.formatted_address,
    lat: x.geometry.location.lat,
    lng: x.geometry.location.lng,
    provider_id: x.place_id || null,
    city: gComp(x.address_components, 'locality') || gComp(x.address_components, 'administrative_area_level_2'),
    state: gComp(x.address_components, 'administrative_area_level_1'),
    postal_code: gComp(x.address_components, 'postal_code'),
    country: gComp(x.address_components, 'country'),
    osm_type: '', housenumber: gComp(x.address_components, 'street_number'), street: gComp(x.address_components, 'route')
  }));
}
async function googleGeocodeReverse(lat, lng) {
  const params = new URLSearchParams({ latlng: `${Number(lat)},${Number(lng)}`, key: GOOGLE_KEY });
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Google reverse ${r.status}`);
  const data = await r.json();
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK' || !data.results || !data.results.length) {
    throw new Error(`Google reverse ${data.status}${data.error_message ? `: ${data.error_message}` : ''}`);
  }
  const x = data.results[0];
  return {
    label: x.formatted_address, address: x.formatted_address, lat: Number(lat), lng: Number(lng),
    provider_id: x.place_id || null,
    city: gComp(x.address_components, 'locality'), state: gComp(x.address_components, 'administrative_area_level_1'),
    postal_code: gComp(x.address_components, 'postal_code'), country: gComp(x.address_components, 'country'),
    osm_type: '', housenumber: gComp(x.address_components, 'street_number'), street: gComp(x.address_components, 'route')
  };
}
async function googleRoute(points) {
  const origin = `${Number(points[0].lat)},${Number(points[0].lng)}`;
  const destination = `${Number(points[points.length - 1].lat)},${Number(points[points.length - 1].lng)}`;
  const waypoints = points.slice(1, -1).map((p) => `${Number(p.lat)},${Number(p.lng)}`).join('|');
  const params = new URLSearchParams({ origin, destination, key: GOOGLE_KEY, mode: 'driving', departure_time: 'now' });
  if (waypoints) params.set('waypoints', waypoints);
  const r = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Google directions ${r.status}`);
  const data = await r.json();
  if (data.status !== 'OK' || !data.routes || !data.routes.length) throw new Error(data.error_message || `Google directions ${data.status}`);
  const route = data.routes[0];
  const coords = route.overview_polyline && route.overview_polyline.points
    ? decodePolyline(route.overview_polyline.points).map(([la, ln]) => [ln, la])
    : points.map((p) => [Number(p.lng), Number(p.lat)]);
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distanceMeters: route.legs.reduce((a, l) => a + (l.distance ? l.distance.value : 0), 0),
    durationSeconds: route.legs.reduce((a, l) => a + (l.duration ? l.duration.value : 0), 0),
    legs: route.legs.map((l) => ({ distanceMeters: l.distance ? l.distance.value : 0, durationSeconds: l.duration ? l.duration.value : 0, summary: l.summary || '' })),
    provider: 'google'
  };
}

/* ---------- memory cache ---------- */
const memCache = new Map();
function cacheGetByKind(kind, key) {
  const e = memCache.get(kind + '|' + key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { memCache.delete(kind + '|' + key); return null; }
  return e.val;
}
function cacheSetByKind(kind, key, val) {
  const mk = kind + '|' + key;
  if (memCache.size >= MEM_MAX) { const oldest = memCache.keys().next().value; memCache.delete(oldest); }
  memCache.set(mk, { val, ts: Date.now() });
}

/* ---------- DB cache helpers ---------- */
function dbCacheGet(kind, key) {
  try {
    const table = kind === 'route' ? 'geo_route_cache' : 'geo_result_cache';
    const row = db.prepare(`SELECT result, expires_at FROM ${table} WHERE cache_key = ?`).get(key);
    if (!row) return null;
    if (!row.expires_at || Date.now() > Number(row.expires_at)) {
      db.prepare(`DELETE FROM ${table} WHERE cache_key = ?`).run(key);
      return null;
    }
    try { return JSON.parse(row.result); } catch { return null; }
  } catch (e) { return null; }
}
function dbCacheSet(kind, key, val) {
  try {
    const table = kind === 'route' ? 'geo_route_cache' : 'geo_result_cache';
    const body = JSON.stringify(val);
    const exp = Date.now() + CACHE_TTL_MS;
    if (kind === 'route') {
      db.prepare(`INSERT INTO geo_route_cache (cache_key, profile, points, result, distance_meters, duration_seconds, expires_at) VALUES (?, 'driving', ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result, expires_at = excluded.expires_at`)
        .run(key, key, body, Number(val.distanceMeters) || 0, Number(val.durationSeconds) || 0, exp);
    } else {
      db.prepare(`INSERT INTO geo_result_cache (kind, cache_key, result, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result, expires_at = excluded.expires_at`)
        .run(kind === 'route' ? 'route' : kind, key, body, exp);
    }
  } catch (e) { /* cache writes never fail the request */ }
}

/* ---------- normalization ---------- */
function normalizeFeature(f) {
  const p = f.properties || {};
  const g = f.geometry || {};
  const coords = g.coordinates || [];
  // Photon splits Indian localities inconsistently: metro areas often carry
  // only `county`/`district` and no `city`. Use those for the human-readable
  // address text, but keep `city` strict (city/locality only) so auto-placement
  // never invents a taluk as a city.
  const cityText = p.city || p.locality || p.district || p.county || '';
  const city = p.city || p.locality || '';
  const state = p.state || p.region || '';
  return {
    label: p.label || p.name || '',
    address: [p.name, p.housenumber, p.street, cityText, p.state || p.region, p.postcode, p.country].filter(Boolean).join(', '),
    lat: coords[1],
    lng: coords[0],
    provider_id: (p.osm_id != null ? String(p.osm_id) : null),
    city,
    state,
    postal_code: p.postcode || '',
    country: p.country || '',
    osm_type: p.osm_type || '',
    housenumber: p.housenumber || '',
    street: p.street || ''
  };
}

/* ---------- Nominatim fallback (better business/POI coverage) ---------- */
const NOMINATIM_BASE = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
let nominatimLast = 0;
let nominatimChain = Promise.resolve();
// Nominatim's usage policy asks for at most one request per second. All calls
// are serialised through this tiny queue; results are cached above anyway.
function nominatimGate() {
  nominatimChain = nominatimChain.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - nominatimLast));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nominatimLast = Date.now();
  });
  return nominatimChain;
}
function nominatimNormalize(x) {
  const a = x.address || {};
  const locality = a.city || a.town || a.village || a.municipality || a.city_district || a.suburb || '';
  return {
    label: x.name || String(x.display_name || '').split(',')[0] || '',
    address: x.display_name || '',
    lat: Number(x.lat),
    lng: Number(x.lon),
    provider_id: x.place_id != null ? 'N' + x.place_id : null,
    city: a.city || a.town || a.village || a.municipality || '',
    state: a.state || a.region || '',
    postal_code: a.postcode || '',
    country: a.country || '',
    osm_type: x.osm_type || '',
    housenumber: a.house_number || '',
    street: a.road || '',
    locality,
    provider: 'nominatim'
  };
}
async function nominatimSearch(query, { limit = 8 } = {}) {
  await nominatimGate();
  const params = new URLSearchParams({
    q: String(query).trim(),
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
    'accept-language': 'en'
  });
  const r = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: { 'User-Agent': 'GetInRoute/1.0 (support@getinroute.in)', Accept: 'application/json' },
    signal: AbortSignal.timeout(9000)
  });
  if (!r.ok) throw new Error(`Nominatim returned ${r.status}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : [])
    .map(nominatimNormalize)
    .filter((x) => !Number.isNaN(x.lat) && !Number.isNaN(x.lng))
    .slice(0, limit);
}

/* Query cleanup: users paste Google-Maps-style strings ("Sagility India
   Private Limited, near Electronic City"). Try the raw text, then variants
   with directional noise and company suffixes removed. */
const NAME_NOISE = /\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp|inc\.?|corp\.?|corporation|company)\b/gi;
const NEAR_NOISE = /\b(near|opposite|opp\.?|behind|beside|adjacent\s+to|next\s+to)\b[^,]*/gi;
function queryVariants(q) {
  const base = String(q).trim();
  const out = [base];
  const push = (v) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const noNear = base.replace(NEAR_NOISE, ' ').replace(/\s*,\s*,+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
  push(noNear);
  push(noNear.replace(NAME_NOISE, ' ').replace(/\s*,\s*,+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, ''));
  const segs = base.split(',').map((s) => s.trim()).filter(Boolean);
  if (segs.length > 2) {
    push(segs.slice(0, 2).join(', '));
    push(segs.slice(0, 2).join(', ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim());
  }
  return out.slice(0, 4);
}
const GENERIC_TOKENS = new Set(['india', 'indian', 'private', 'pvt', 'ltd', 'limited', 'llp', 'inc', 'corp', 'corporation',
  'company', 'technologies', 'technology', 'solutions', 'services', 'systems', 'group', 'international', 'global',
  'near', 'opposite', 'the', 'and', 'of', 'office', 'branch']);
function keyTokens(query) {
  const first = String(query).split(',')[0] || '';
  const words = first.toLowerCase().match(/[a-z0-9]+/g) || [];
  return [...new Set(words)].filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
}
function looksRelevant(rows, tokens) {
  if (!tokens.length) return rows.length > 0;
  return rows.some((r) => {
    const hay = `${r.label || ''} ${r.address || ''}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}
async function photonSearch(query, limit, bbox) {
  const params = new URLSearchParams({ q: String(query).trim(), lang: 'en', limit: String(limit) });
  if (bbox) params.set('bbox', bbox);
  const r = await fetch(`${GEOCODER_BASE}/api?${params}`, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Geocoder returned ${r.status}`);
  const data = await r.json();
  return (data.features || [])
    .map(normalizeFeature)
    .filter((f) => f.lat != null && f.lng != null && !Number.isNaN(Number(f.lat)));
}

/* Resolve a Google Maps short/share link to its final URL so the frontend can
   extract the exact pin. Strictly limited to Google-owned hosts (SSRF guard). */
const MAP_LINK_HOSTS = /(^|\.)(google\.com|google\.co\.[a-z]{2,3}|goo\.gl|g\.co|maps\.app\.goo\.gl)$/i;
async function resolveMapLink(rawUrl) {
  let current;
  try { current = new URL(String(rawUrl || '').trim()); } catch { return null; }
  if (current.protocol !== 'https:' && current.protocol !== 'http:') return null;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!MAP_LINK_HOSTS.test(current.hostname)) return null;
    const r = await fetch(current.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GetInRouteBot/1.0; +https://getinroute.in)' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current);
      continue;
    }
    return r.url || current.href;
  }
  return current.href;
}

function routeKey(points) {
  return points.map((p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`).join(';');
}

/* ---------- public API ---------- */
async function geocodeSearch(query, { limit = 8, lang = 'en', bbox } = {}) {
  if (!query || String(query).trim().length < 2) return [];
  const key = `s:${String(query).trim().toLowerCase()}|${bjKey(bbox)}|${limit}`;
  const cached = cacheGetByKind('search', key) || dbCacheGet('search', key);
  if (cached) return cached;

  if (GOOGLE_KEY && googleHealth.geocode) {
    try {
      const rows = await googleGeocodeSearch(query, { limit });
      if (rows.length) { cacheSetByKind('search', key, rows); dbCacheSet('search', key, rows); return rows; }
    } catch (e) {
      console.warn('[geo] Google search failed, using Photon:', e.message || e);
      if (isGoogleAuthFailure(e)) { googleHealth.geocode = false; console.warn('[geo] Google geocoding disabled for this process (auth/billing) — using Photon from now on.'); }
    }
  }

  const tokens = keyTokens(query);
  const variants = queryVariants(query);
  let firstNonEmpty = null;

  // 1) Photon (OSM autocomplete). Walk the cleaned-up variants; only accept a
  //    set when it actually mentions the place we asked for.
  for (const v of variants) {
    let rows = [];
    try { rows = await photonSearch(v, limit, bbox); } catch (e) { rows = []; }
    if (!rows.length) continue;
    if (!firstNonEmpty) firstNonEmpty = rows;
    if (looksRelevant(rows, tokens)) {
      cacheSetByKind('search', key, rows);
      dbCacheSet('search', key, rows);
      return rows;
    }
  }

  // 2) Nominatim (same OSM data, but much better business/POI indexing).
  for (const v of variants.slice(0, 2)) {
    try {
      const rows = await nominatimSearch(v, limit);
      if (rows.length && (looksRelevant(rows, tokens) || !firstNonEmpty)) {
        cacheSetByKind('search', key, rows);
        dbCacheSet('search', key, rows);
        return rows;
      }
    } catch (e) { /* provider unavailable — fall through */ }
  }

  const out = firstNonEmpty || [];
  cacheSetByKind('search', key, out);
  dbCacheSet('search', key, out);
  return out;
}

async function geocodeReverse(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) return null;
  const key = `r:${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  const cached = cacheGetByKind('reverse', key) || dbCacheGet('reverse', key);
  if (cached) return cached;

  if (GOOGLE_KEY && googleHealth.geocode) {
    try {
      const row = await googleGeocodeReverse(lat, lng);
      if (row) { cacheSetByKind('reverse', key, row); dbCacheSet('reverse', key, row); }
      return row;
    } catch (e) {
      console.warn('[geo] Google reverse failed, using Photon:', e.message || e);
      if (isGoogleAuthFailure(e)) { googleHealth.geocode = false; console.warn('[geo] Google geocoding disabled for this process (auth/billing) — using Photon from now on.'); }
    }
  }

  const params = new URLSearchParams({ lat: String(Number(lat)), lon: String(Number(lng)) });
  const r = await fetch(`${GEOCODER_BASE}/reverse?${params}`, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Geocoder reverse returned ${r.status}`);
  const data = await r.json();
  const row = (!data.features || !data.features.length) ? null : normalizeFeature(data.features[0]);
  if (row) { cacheSetByKind('reverse', key, row); dbCacheSet('reverse', key, row); }
  return row;
}

async function calculateRoute(points, { profile = 'driving', useCache = true } = {}) {
  if (!points || points.length < 2) throw new Error('At least 2 points required');
  const key = `rt:${profile}:${routeKey(points)}`;
  if (useCache) {
    const cached = cacheGetByKind('route', key) || dbCacheGet('route', routeKey(points));
    if (cached) return cached;
  }

  if (GOOGLE_KEY && googleHealth.routing) {
    try {
      const result = await googleRoute(points);
      if (useCache) { cacheSetByKind('route', key, result); dbCacheSet('route', key, result); }
      return result;
    } catch (e) {
      console.warn('[geo] Google routing failed, using OSRM:', e.message || e);
      if (isGoogleAuthFailure(e)) { googleHealth.routing = false; console.warn('[geo] Google routing disabled for this process (auth/billing) — using OSRM from now on.'); }
    }
  }

  try {
    const coords = points.map((p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
    const r = await fetch(
      `${ROUTING_BASE}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (!r.ok) throw new Error(`Routing service returned ${r.status}`);
    const data = await r.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      throw new Error(data.message || 'No driving route found between these points');
    }
    const route = data.routes[0];
    const result = {
      geometry: route.geometry,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      legs: (route.legs || []).map((l) => ({
        distanceMeters: l.distance,
        durationSeconds: l.duration,
        summary: l.summary || ''
      }))
    };
    if (useCache) { cacheSetByKind('route', key, result); dbCacheSet('route', key, result); }
    return result;
  } catch (e) {
    // Provider unreachable/misconfigured — never leave the caller without a
    // route: fall back to a straight-line overview with estimated time.
    const fallback = fallbackRoute(points);
    if (useCache) { cacheSetByKind('route', key, fallback); dbCacheSet('route', key, fallback); }
    console.warn('[geo] routing provider failed, used fallback line:', e.message || e);
    return fallback;
  }
}

function haversineMeters(p1, p2) {
  const R = 6371000;
  const dLat = (Number(p2.lat) - Number(p1.lat)) * Math.PI / 180;
  const dLng = (Number(p2.lng) - Number(p1.lng)) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(Number(p1.lat) * Math.PI / 180) * Math.cos(Number(p2.lat) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Geometric fallback used only when the routing provider is unavailable.
function fallbackRoute(points) {
  const coords = points.map((p) => [Number(p.lng), Number(p.lat)]);
  const distanceMeters = points.slice(1).reduce((acc, p, i) => acc + haversineMeters(points[i], p), 0);
  const durationSeconds = (distanceMeters / 1000) / 25 * 3600; // ~25 km/h urban estimate
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(durationSeconds),
    legs: points.slice(1).map((p, i) => ({
      distanceMeters: Math.round(haversineMeters(points[i], p)),
      durationSeconds: Math.round((haversineMeters(points[i], p) / 1000 / 25) * 3600),
      summary: ''
    })),
    fallback: true
  };
}

function bjKey(bbox) {
  return Array.isArray(bbox) ? bbox.join(',') : '';
}

module.exports = { geocodeSearch, geocodeReverse, calculateRoute, effectiveProviders, resolveMapLink };