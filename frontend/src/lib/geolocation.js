/* Browser geolocation helper.
 *
 * Why this exists: calling navigator.geolocation.getCurrentPosition() on every
 * login makes Chrome/Safari show the "allow once / allow always" permission
 * bubble again and again. We only EVER ask the browser when the user clicks a
 * "Use my location" control (interactive: true). Background callers (login,
 * dashboards) read the last known position from sessionStorage and otherwise
 * stay silent — no prompt, no error.
 */

const POS_CACHE_KEY = 'gir_geo_last_position';
const PERMISSION_TTL_MS = 30 * 1000;
// Kept across page loads so repeatedly using "Use my location" (or signing in)
// never re-triggers the browser permission prompt. Tight enough to stay useful
// for pickups; callers can override the max age.
const POSITION_TTL_MS = 30 * 60 * 1000;

export async function geolocationPermissionState() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch { /* Permissions API unavailable — treat as unknown */ }
  return 'unknown';
}

export function readCachedPosition(maxAgeMs = POSITION_TTL_MS) {
  try {
    const raw = localStorage.getItem(POS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    if (!parsed.ts || Date.now() - parsed.ts > maxAgeMs) return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch { return null; }
}

export function cachePosition(lat, lng) {
  try {
    localStorage.setItem(POS_CACHE_KEY, JSON.stringify({ lat: Number(lat), lng: Number(lng), ts: Date.now() }));
  } catch { /* private mode / quota — caching is optional */ }
}

/* Resolve the device position without ever prompting unless interactive.
 * Returns { lat, lng } or null. Never rejects. */
export async function getPosition({ interactive = false, timeout = 10000, maxAgeMs = POSITION_TTL_MS } = {}) {
  if (!navigator.geolocation) return null;

  const cached = readCachedPosition(maxAgeMs);
  if (cached) return cached;

  if (!interactive) {
    const state = await geolocationPermissionState();
    if (state !== 'granted') return null; // silently skip — do not prompt
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          cachePosition(lat, lng);
          done({ lat, lng });
        },
        () => done(null),
        { enableHighAccuracy: false, timeout, maximumAge: maxAgeMs }
      );
    } catch {
      done(null);
    }
    // Safety net: some browsers never fire either callback for blocked prompts.
    setTimeout(() => done(null), timeout + 500);
  });
}

let permissionWarmAt = 0;
let permissionWarmValue = 'unknown';
/* Cheap, non-prompting permission probe used by UI to decide whether to show
 * the "location blocked" hint. Cached briefly to avoid repeated queries. */
export async function permissionHint() {
  if (Date.now() - permissionWarmAt < PERMISSION_TTL_MS) return permissionWarmValue;
  permissionWarmValue = await geolocationPermissionState();
  permissionWarmAt = Date.now();
  return permissionWarmValue;
}
