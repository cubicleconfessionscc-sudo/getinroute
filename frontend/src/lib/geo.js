/* GetInRoute Geo Client
   Frontend proxy client that hits backend /api/geo/* endpoints.
   Keeps all external provider calls server-side. */

import { api } from '../api';

export async function searchAddress(query, { limit = 8 } = {}) {
  if (!query || query.length < 2) return [];
  const r = await api.get('/api/geo/search', { q: query, limit: String(limit) });
  return Array.isArray(r) ? r : [];
}

/* --- Pasted exact pins -------------------------------------------------------
   People copy locations out of Google Maps. A pasted Google link, raw
   coordinates or Plus Code carries the exact point, which is always more
   reliable than re-geocoding a fuzzy business name. These helpers only parse;
   callers still reverse-geocode for a human-readable address. */

export function isMapLink(text) {
  const s = String(text || '').trim();
  return /^https?:\/\//i.test(s) && /(google\.[a-z.]+|goo\.gl|g\.co|maps\.app\.goo\.gl)/i.test(s);
}

export function parseLatLng(text) {
  const s = String(text || '').trim().replace(/^\(|\)$/g, '');
  const m = s.match(/^(-?\d{1,3}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseMapUrlCoordinates(url) {
  const s = String(url || '');
  let m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/[?&](?:q|query|ll|center|destination|sll|daddr|viewpoint)=(-?\d{1,3}\.\d+)[,%C\s]+(-?\d{1,3}\.\d+)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  return null;
}

export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  return api.get('/api/geo/reverse', { lat: String(lat), lng: String(lng) });
}

/* --- Address-name resolution -------------------------------------------------
   Screens render address names instead of raw coordinates, so every picked
   point gets named once. De-duplicated per module: a screen with twenty rows
   makes at most one request per distinct point, repeats are free (memory), and
   the backend keeps a 1h DB cache so a page reload costs nothing either. */

const COORD_SHAPED = /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;
const addrCache = new Map();
const addrInflight = new Map();

export const isCoordsOnly = (text) => COORD_SHAPED.test(String(text || '').trim());
export const coordLabel = (lat, lng) =>
  lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))
    ? ''
    : `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

export function resolveAddress(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return Promise.resolve('');
  }
  const key = coordLabel(lat, lng);
  if (addrCache.has(key)) return Promise.resolve(addrCache.get(key));
  if (addrInflight.has(key)) return addrInflight.get(key);
  const job = reverseGeocode(lat, lng)
    .then((r) => {
      const addr = r && r.address ? String(r.address) : '';
      addrCache.set(key, addr);
      return addr;
    })
    .catch(() => {
      addrCache.set(key, '');
      return '';
    })
    .finally(() => addrInflight.delete(key));
  addrInflight.set(key, job);
  return job;
}

export async function calculateRoute(points) {
  if (!points || points.length < 2) throw new Error('At least 2 points required');
  return api.post('/api/geo/route', { points });
}

/* Resolve a picked point to a displayable address, falling back to a
   coordinate string only when the provider cannot name it — a saved location
   must never lose its point. Callers keep the real lat/lng separately, so
   routing/tracking are unaffected either way. */
export async function pickLocation(lat, lng) {
  const n = { lat: Number(lat), lng: Number(lng) };
  if (Number.isNaN(n.lat) || Number.isNaN(n.lng)) return null;
  const address = (await resolveAddress(n.lat, n.lng)) || `${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
  return { ...n, address };
}
