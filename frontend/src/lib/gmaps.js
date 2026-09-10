export const gmapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

if (!gmapsKey) console.warn('[GetInRoute] VITE_GOOGLE_MAPS_API_KEY is EMPTY in this build — maps will fall back to OpenStreetMap');
else if (import.meta.env.DEV) console.log('[GetInRoute] GM key present, length', gmapsKey.length);

let promise = null;

export function googleMapsEnabled() {
  return !!gmapsKey;
}

export function loadGoogleMaps() {
  if (!gmapsKey) return Promise.resolve(null);
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google && window.google.maps && window.google.maps.places) return Promise.resolve(window.google);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(gmapsKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.onload = () => {
      if (window.google && window.google.maps) { console.log('[GetInRoute] Google Maps loaded OK'); resolve(window.google); }
      else { promise = null; reject(new Error('Google Maps loaded but namespace missing')); }
    };
    script.onerror = () => { promise = null; console.error('[GetInRoute] Google Maps script FAILED to load (network/adblock/key)'); reject(new Error('Failed to load Google Maps script')); };
    document.head.appendChild(script);
  });
  return promise;
}
