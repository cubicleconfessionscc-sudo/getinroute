import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LocateFixed, MapPin, Check, Loader2 } from 'lucide-react';
import MapLibreMap from '../../components/MapLibreMap';
import AddressPicker from '../../components/AddressPicker';
import { pickLocation } from '../../lib/geo';

/* Full-screen "pick a location" page shared by every portal.
   Search an address (autocomplete), drop or drag the pin, then Confirm — the
   same Google-Maps-style flow, running entirely on the free MapLibre +
   OpenStreetMap stack, so it works with no key and no billing. It hands the
   result back to the page that opened it (postMessage for a popup, or
   sessionStorage + a route back for a same-tab/webview flow) and the caller
   keeps storing latitude/longitude internally exactly as before.

   Query params: returnToken, address, lat, lng, place_id, radius, returnTo, title */

export const MAP_LOCATION_RESULT_KEY = 'map-location-result';

export default function LocationPickerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('returnToken') || '';
  const returnTo = params.get('returnTo') || '';
  const radius = Math.max(1, Number(params.get('radius')) || 1000);
  const title = params.get('title') || 'Select location on the map';

  const revSeq = useRef(0);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [naming, setNaming] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const lat = params.has('lat') ? Number(params.get('lat')) : null;
    const lng = params.has('lng') ? Number(params.get('lng')) : null;
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      const address = params.get('address') || '';
      setSelected({ lat, lng, address, place_id: params.get('place_id') || '' });
      setFocus({ lat, lng });
      // A point restored from the caller may have no name on record yet.
      if (!address) void namePoint(lat, lng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const namePoint = async (lat, lng) => {
    const seq = ++revSeq.current;
    setNaming(true);
    const picked = await pickLocation(lat, lng);
    if (seq !== revSeq.current) return; // a newer pick superseded this lookup
    setSelected((prev) => (prev && prev.lat === Number(lat) && prev.lng === Number(lng)
      ? { ...prev, address: picked?.address || '' }
      : prev));
    setNaming(false);
  };

  const selectPoint = (lat, lng, address = '', placeId = '') => {
    const point = { lat: Number(lat), lng: Number(lng) };
    revSeq.current += 1; // invalidate any in-flight naming job for the old point
    setSelected((prev) => ({ ...(prev || {}), ...point, address: address || '', place_id: placeId || '' }));
    if (address) { setNaming(false); return; }
    void namePoint(point.lat, point.lng);
  };

  const onSearchPick = (item) => {
    if (!item || item.lat == null || item.lng == null) return;
    selectPoint(item.lat, item.lng, item.address || '', item.provider_id || '');
    setFocus({ lat: Number(item.lat), lng: Number(item.lng) });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        selectPoint(p.coords.latitude, p.coords.longitude);
        setFocus({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => { setLocating(false); setError('Could not get your location — check browser permission, or search the address instead.'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const hasPoint = selected && selected.lat != null && selected.lng != null
    && !Number.isNaN(Number(selected.lat)) && !Number.isNaN(Number(selected.lng));
  const canConfirm = hasPoint && !!selected.address && !naming;

  const confirm = () => {
    if (!hasPoint) { setError('Search for an address or drop a pin on the map first.'); return; }
    if (!selected.address) { setError('We could not name that point — try again in a moment.'); return; }
    const result = {
      type: 'GETINROUTE_MAP_LOCATION',
      returnToken: token,
      address: selected.address,
      lat: Number(selected.lat),
      lng: Number(selected.lng),
      place_id: selected.place_id || ''
    };
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(result, window.location.origin);
      window.close();
      return;
    }
    try { sessionStorage.setItem(MAP_LOCATION_RESULT_KEY, JSON.stringify(result)); } catch (e) { /* locked-down browsers */ }
    navigate(returnTo || '/admin/settings', { replace: true });
  };

  const cancel = () => {
    if (window.opener && !window.opener.closed) { window.close(); return; }
    if (returnTo) navigate(returnTo, { replace: true });
    else navigate(-1);
  };

  return (
    <main style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#f8fafc', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, flex: 1 }}>{title}</h1>
        <button type="button" className="btn btn-outline" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={16} />} {locating ? 'Locating…' : 'Use my location'}
        </button>
      </header>
      {error && (
        <div role="alert" style={{ padding: 12, borderRadius: 8, background: '#fff1f2', color: '#be123c', fontWeight: 700 }}>
          {error}
        </div>
      )}

      <AddressPicker value={hasPoint ? { address: selected.address || '', lat: selected.lat, lng: selected.lng } : null} onChange={onSearchPick} />

      <div style={{ flex: 1, minHeight: 280 }} data-testid="location-map">
        <MapLibreMap
          center={hasPoint ? { lat: Number(selected.lat), lng: Number(selected.lng) } : null}
          zoom={hasPoint ? 15 : 11}
          markers={hasPoint ? [{ id: 'pick', lat: Number(selected.lat), lng: Number(selected.lng), color: 'indigo' }] : []}
          circles={hasPoint ? [{ lat: Number(selected.lat), lng: Number(selected.lng), radius }] : []}
          onPick={(la, ln) => selectPoint(la, ln)}
          onMarkerDrag={(id, la, ln) => selectPoint(la, ln)}
          focus={focus}
          fit={false}
          height="100%"
        />
      </div>

      <section aria-live="polite" style={{ background: 'white', borderRadius: 10, padding: 12, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <b>Address:</b>{' '}
            {hasPoint
              ? (naming ? <span style={{ color: 'var(--muted)' }}>Naming this point…</span> : (selected.address || <span style={{ color: 'var(--muted)' }}>Not named yet</span>))
              : <span style={{ color: 'var(--muted)' }}>Not selected</span>}
            <div style={{ color: 'var(--muted)', marginTop: 2 }}>
              Tap the map or drag the pin to fine-tune. Service radius shown on the map: {radius} m.
            </div>
          </div>
        </div>
      </section>

      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn btn-outline" onClick={cancel}>Cancel</button>
        <button
          type="button"
          data-testid="confirm-location"
          className="btn btn-primary"
          disabled={!canConfirm}
          onClick={confirm}
        >
          <Check size={16} /> Confirm location
        </button>
      </footer>
    </main>
  );
}
