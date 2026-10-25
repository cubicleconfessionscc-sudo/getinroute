import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, ChevronLeft, LocateFixed, Loader2, Check } from 'lucide-react';
import MapLibreMap from '../../components/MapLibreMap';
import AddressPicker from '../../components/AddressPicker';
import { reverseGeocode } from '../../lib/geo';
import { getPosition } from '../../lib/geolocation';
import { MAP_DEFAULTS } from '../../config/maps';

/* Keyless mobile map picker.
 *
 * The Android app embeds this page in a WebView because the Google Maps
 * Android key configured for the apps is a browser-referrer key and cannot
 * authorise native maps. MapLibre + OpenStreetMap needs no key at all, so the
 * picker renders reliably here and reports the chosen point back to the app
 * through ReactNativeWebView.postMessage.
 *
 * Public route (/mobile-map) — read-only, no account data is exposed. */

function postToApp(payload) {
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      return true;
    }
  } catch { /* not inside the app */ }
  return false;
}

export default function MobileMapPicker() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const latParam = params.get('lat');
  const lngParam = params.get('lng');
  const hasInitial = latParam != null && latParam !== '' && lngParam != null && lngParam !== ''
    && Number.isFinite(Number(latParam)) && Number.isFinite(Number(lngParam));
  const [selected, setSelected] = useState(() => (hasInitial
    ? { lat: Number(latParam), lng: Number(lngParam), address: params.get('address') || '' }
    : null));
  const [center, setCenter] = useState(() => (hasInitial
    ? { lat: Number(latParam), lng: Number(lngParam) }
    : { lat: MAP_DEFAULTS.center[1], lng: MAP_DEFAULTS.center[0] }));
  const [naming, setNaming] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState('');
  const [inApp] = useState(() => !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage));

  const select = useCallback(async (lat, lng, address = '') => {
    const point = { lat: Number(lat), lng: Number(lng), address: address || '' };
    setSelected(point);
    setCenter({ lat: point.lat, lng: point.lng });
    if (point.address) return;
    setNaming(true);
    try {
      const row = await reverseGeocode(point.lat, point.lng).catch(() => null);
      const named = (row && row.address) || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
      setSelected((prev) => (prev && prev.lat === point.lat && prev.lng === point.lng ? { ...prev, address: named } : prev));
    } finally { setNaming(false); }
  }, []);

  useEffect(() => {
    if (hasInitial && !params.get('address')) void select(Number(latParam), Number(lngParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app screens are light; use the light theme tokens for the embedded
  // inputs/dropdown so this page matches the employee app.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => { if (prev) root.setAttribute('data-theme', prev); else root.removeAttribute('data-theme'); };
  }, []);

  const useMyLocation = async () => {
    setErr('');
    setLocating(true);
    try {
      const pos = await getPosition({ interactive: true });
      if (!pos) { setErr('Could not get your location. Allow location access, or search the address.'); return; }
      const row = await reverseGeocode(pos.lat, pos.lng).catch(() => null);
      await select(pos.lat, pos.lng, (row && row.address) || '');
    } finally { setLocating(false); }
  };

  const confirm = () => {
    if (!selected || !selected.address) { setErr('Pick a point on the map first.'); return; }
    const ok = postToApp({ type: 'picked', lat: selected.lat, lng: selected.lng, address: selected.address });
    if (!ok) setErr('This page must be opened from the app to return the location.');
  };

  const cancel = () => {
    if (!postToApp({ type: 'cancel' })) nav(-1);
  };

  const hasPoint = !!(selected && selected.lat != null && selected.lng != null);
  const markers = useMemo(() => (hasPoint ? [{ id: 'pick', lat: selected.lat, lng: selected.lng, color: 'indigo' }] : []), [hasPoint, selected]);

  return (
    <div style={{ height: '100vh', background: '#f4f7fb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 12px', background: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 5 }}>
        <button type="button" onClick={cancel} style={{ border: 0, background: 'none', display: 'flex', alignItems: 'center', gap: 2, color: '#2563eb', fontWeight: 700, fontSize: 15, padding: '4px 6px' }}>
          <ChevronLeft size={18} /> Back
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#0f172a' }}>Pick on map</div>
        <span style={{ width: 60 }} />
      </header>

      <div style={{ padding: '10px 12px', background: '#fff', flexShrink: 0 }}>
        <AddressPicker
          mapButton={false}
          value={hasPoint ? { address: selected.address || '', lat: selected.lat, lng: selected.lng } : null}
          onChange={(item) => { if (item && item.lat != null && item.lng != null) void select(item.lat, item.lng, item.address || ''); }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button type="button" className="btn btn-outline" onClick={useMyLocation} disabled={locating} style={{ padding: '6px 10px', fontSize: 13 }}>
            {locating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={14} />} {locating ? 'Locating…' : 'My location'}
          </button>
          <span style={{ fontSize: 11.5, color: '#64748b' }}>Tap the map or drag the pin to adjust.</span>
        </div>
        {err ? <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fff1f2', color: '#be123c', fontSize: 12.5, fontWeight: 600 }}>{err}</div> : null}
      </div>

      <div style={{ flex: 1, minHeight: 220, padding: '10px 12px', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 10, borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#e9eef4' }}>
          <MapLibreMap
            center={center}
            zoom={hasPoint ? 16 : 12}
            markers={markers}
            onPick={(lat, lng) => { void select(lat, lng); }}
            onMarkerDrag={(_id, lat, lng) => { void select(lat, lng); }}
            fit={false}
            height="100%"
          />
        </div>
      </div>

      <div style={{ flexShrink: 0, background: '#fff', borderTop: '1px solid #e2e8f0', padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>Selected point</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
          <MapPin size={16} color="#2563eb" style={{ marginTop: 3, flexShrink: 0 }} />
          <div style={{ fontSize: 13.5, color: '#0f172a', fontWeight: 600, lineHeight: 1.35 }}>
            {hasPoint
              ? (naming ? 'Naming this point…' : (selected.address || 'Not named yet'))
              : 'Search an address, use your location, or tap the map.'}
          </div>
        </div>
        {hasPoint ? (
          <div style={{ fontSize: 11, color: '#2563eb', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}>
            {Number(selected.lat).toFixed(5)}, {Number(selected.lng).toFixed(5)}
          </div>
        ) : null}
        {!inApp ? (
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>Preview mode — open this page from the GetInRoute app to use the selection.</div>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          onClick={confirm}
          disabled={!hasPoint || naming}
          style={{ width: '100%', justifyContent: 'center', marginTop: 10, padding: '13px 16px', fontSize: 15 }}
        >
          <Check size={16} /> Confirm location
        </button>
      </div>
    </div>
  );
}
