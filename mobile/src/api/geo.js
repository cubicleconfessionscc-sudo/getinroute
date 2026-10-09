import client from "./client";

// Forward geocoding (typed address -> coordinates) via the backend's existing
// geo integration (Photon/OSM by default, Google when the server key is set).
// Runs server-side so no geocoding API key ever ships inside the app.
export function geoSearch(query, { limit = 6 } = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return Promise.resolve([]);
  return client
    .get("/geo/search", { params: { q, limit } })
    .then((r) => (Array.isArray(r.data) ? r.data : []));
}

// Reverse geocoding (coordinates -> human address).
export function geoReverse(lat, lng) {
  return client
    .get("/geo/reverse", { params: { lat, lng } })
    .then((r) => r.data);
}
