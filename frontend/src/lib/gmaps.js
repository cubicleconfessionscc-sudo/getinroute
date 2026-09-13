/* Google Maps loader — runtime-first.
   The API key is resolved at RUNTIME from the backend (/api/config/public)
   so production can enable Google Maps purely by setting a Railway variable —
   no rebuild, no redeploy. A build-time key (VITE_GOOGLE_MAPS_API_KEY) takes
   precedence for local dev. When no key is available the app shows a clear
   configuration error instead of silently swapping in a different map. */

const BUILD_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const CACHE_KEY = 'gir_google_key';
const CACHE_TTL = 60 * 60 * 1000;

let runtimeKey = null;
let runtimePromise = null;

export function buildGoogleMapsKey() {
  return BUILD_KEY;
}

async function fetchRuntimeKey() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.key && Date.now() - c.at < CACHE_TTL) { runtimeKey = c.key; return c.key; }
  } catch {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('/api/config/public', { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('config fetch failed');
    const d = await r.json();
    runtimeKey = (d && d.googleMapsApiKey) || BUILD_KEY || null;
    if (runtimeKey) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: runtimeKey, at: Date.now() })); } catch {}
    }
    return runtimeKey;
  } catch {
    runtimeKey = BUILD_KEY || null;
    return runtimeKey;
  }
}

export function getGoogleMapsKey() {
  if (BUILD_KEY) return Promise.resolve(BUILD_KEY);
  if (runtimeKey) return Promise.resolve(runtimeKey);
  if (runtimePromise) return runtimePromise;
  runtimePromise = fetchRuntimeKey().finally(() => { runtimePromise = null; });
  return runtimePromise;
}

export async function googleMapsEnabled() {
  return !!(await getGoogleMapsKey());
}

let promise = null;

export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google && window.google.maps && window.google.maps.places) return Promise.resolve(window.google);
  if (promise) return promise;
  promise = getGoogleMapsKey().then((key) => {
    if (!key) return null;
    if (window.google && window.google.maps) return Promise.resolve(window.google);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,directions&v=weekly`;
      script.async = true;
      script.onload = () => {
        if (window.google && window.google.maps) resolve(window.google);
        else { promise = null; reject(new Error('Google Maps loaded but namespace missing')); }
      };
      script.onerror = () => { promise = null; reject(new Error('Failed to load Google Maps script (network/adblock/key).')); };
      document.head.appendChild(script);
    });
  }).then(null, (e) => { promise = null; return Promise.reject(e); });
  return promise;
}

export function mapErrorMessage(e) {
  const s = String((e && e.message) || e);
  if (/ApiNotActivated|referer|KeyInvalid|REQUEST_DENIED/i.test(s)) {
    return 'Google Maps rejected the request — check that the "Maps JavaScript API" and "Places API" are enabled for this key and that getinroute.in is in the allowed referrers.';
  }
  return s || 'Google Maps could not be loaded.';
}