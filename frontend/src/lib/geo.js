/* GetInRoute Geo Client
   Frontend proxy client that hits backend /api/geo/* endpoints.
   Keeps all external provider calls server-side. */

import { api } from '../api';

export async function searchAddress(query, { limit = 8 } = {}) {
  if (!query || query.length < 2) return [];
  const r = await api.get('/api/geo/search', { q: query, limit: String(limit) });
  return Array.isArray(r) ? r : [];
}

export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  return api.get('/api/geo/reverse', { lat: String(lat), lng: String(lng) });
}

export async function calculateRoute(points) {
  if (!points || points.length < 2) throw new Error('At least 2 points required');
  return api.post('/api/geo/route', { points });
}
