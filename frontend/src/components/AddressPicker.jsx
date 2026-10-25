import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search, Loader2, Check, X, LocateFixed } from 'lucide-react';
import { searchAddress, pickLocation, reverseGeocode } from '../lib/geo';
import { getPosition } from '../lib/geolocation';
import MapLibreMap from './MapLibreMap';
import { api } from '../api';

/* Inline "pick a location" dialog opened from any address field. Same
   Google-Maps-style flow (search, tap/drag the pin, name the point, Confirm)
   on the free MapLibre + OpenStreetMap stack — no key, no billing, and it
   never leaves the page, so the form behind it keeps its state. */
export function MapPickerModal({ open, title = 'Select location on the map', initial, onPick, onClose }) {
  const revSeq = useRef(0);
  const [selected, setSelected] = useState(null);
  const [naming, setNaming] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const namePoint = async (lat, lng) => {
    const seq = ++revSeq.current;
    setNaming(true);
    const picked = await pickLocation(lat, lng);
    if (seq !== revSeq.current) return;
    setSelected((prev) => (prev && prev.lat === Number(lat) && prev.lng === Number(lng)
      ? { ...prev, address: picked?.address || '' }
      : prev));
    setNaming(false);
  };

  const selectPoint = (lat, lng, address = '', placeId = '') => {
    const point = { lat: Number(lat), lng: Number(lng) };
    revSeq.current += 1;
    setSelected((prev) => ({ ...(prev || {}), ...point, address: address || '', place_id: placeId || '' }));
    if (address) { setNaming(false); return; }
    void namePoint(point.lat, point.lng);
  };

  useEffect(() => {
    if (!open) return;
    revSeq.current += 1;
    setNaming(false);
    setLocating(false);
    setError('');
    if (initial && initial.lat != null && initial.lng != null && !Number.isNaN(Number(initial.lat)) && !Number.isNaN(Number(initial.lng))) {
      setSelected({ lat: Number(initial.lat), lng: Number(initial.lng), address: initial.address || '', place_id: initial.place_id || '' });
      if (!initial.address) void namePoint(Number(initial.lat), Number(initial.lng));
    } else {
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const useMyLocation = async () => {
    setLocating(true);
    setError('');
    try {
      const pos = await getPosition({ interactive: true });
      if (!pos) {
        setError('Could not get your location — check browser permission, or search the address instead.');
        return;
      }
      selectPoint(pos.lat, pos.lng);
    } finally {
      setLocating(false);
    }
  };

  const hasPoint = !!(selected && selected.lat != null && selected.lng != null
    && !Number.isNaN(Number(selected.lat)) && !Number.isNaN(Number(selected.lng)));
  const canConfirm = hasPoint && !!selected.address && !naming;

  const confirm = () => {
    if (!canConfirm) return;
    onPick && onPick({
      address: selected.address,
      lat: Number(selected.lat),
      lng: Number(selected.lng),
      place_id: selected.place_id || ''
    });
    onClose && onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="map-picker-modal"
      style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
    >
      <div style={{ background: '#f8fafc', borderRadius: 14, width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>{title}</h3>
          <button type="button" className="btn btn-ghost" data-testid="map-picker-close" onClick={() => onClose && onClose()} aria-label="Close" style={{ padding: '6px 8px' }}>
            <X size={16} />
          </button>
        </header>
        {error && (
          <div role="alert" style={{ padding: 10, borderRadius: 8, background: '#fff1f2', color: '#be123c', fontWeight: 600, fontSize: 13 }}>
            {error}
          </div>
        )}
        <AddressPicker
          mapButton={false}
          value={hasPoint ? { address: selected.address || '', lat: selected.lat, lng: selected.lng } : null}
          onChange={(item) => { if (item && item.lat != null && item.lng != null) selectPoint(item.lat, item.lng, item.address || '', item.provider_id || ''); }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={useMyLocation} disabled={locating} style={{ padding: '6px 10px', fontSize: 13 }}>
            {locating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={14} />} {locating ? 'Locating…' : 'Use my location'}
          </button>
        </div>
        <div style={{ height: 'min(46vh, 340px)', minHeight: 220 }} data-testid="location-map">
          <MapLibreMap
            center={hasPoint ? { lat: Number(selected.lat), lng: Number(selected.lng) } : null}
            zoom={hasPoint ? 15 : 11}
            markers={hasPoint ? [{ id: 'pick', lat: Number(selected.lat), lng: Number(selected.lng), color: 'indigo' }] : []}
            onPick={(la, ln) => selectPoint(la, ln)}
            onMarkerDrag={(id, la, ln) => selectPoint(la, ln)}
            fit={false}
            height="100%"
          />
        </div>
        <div aria-live="polite" style={{ background: 'white', borderRadius: 10, padding: 10, fontSize: 13 }}>
          <b>Address:</b>{' '}
          {hasPoint
            ? (naming ? <span style={{ color: 'var(--muted)' }}>Naming this point…</span> : (selected.address || <span style={{ color: 'var(--muted)' }}>Not named yet</span>))
            : <span style={{ color: 'var(--muted)' }}>Tap the map or search an address to select a point.</span>}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose && onClose()}>Cancel</button>
          <button type="button" data-testid="map-picker-confirm" className="btn btn-primary" disabled={!canConfirm} onClick={confirm}>
            <Check size={15} /> Confirm location
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default function AddressPicker({ value, onChange, mapButton = true }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value || null);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [justResolved, setJustResolved] = useState(false);
  const [provider, setProvider] = useState('google');
  const [mapOpen, setMapOpen] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);
  const ddRef = useRef(null);

  useEffect(() => {
    api.get('/api/config/public').then((c) => { if (c && c.geocodingProvider) setProvider(c.geocodingProvider); }).catch(() => {});
  }, []);

  useEffect(() => { if (value) setSelected(value); }, [value && value.address, value && value.lat]);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const items = await searchAddress(q);
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onInputChange = (v) => {
    setQuery(v);
    setJustResolved(false);
    clearTimeout(debounceRef.current);
    if (v.length >= 3) debounceRef.current = setTimeout(() => doSearch(v), 350);
    else setResults([]);
  };

  useEffect(() => {
    const h = (e) => {
      const inBox = boxRef.current && boxRef.current.contains(e.target);
      const inDd = ddRef.current && ddRef.current.contains(e.target);
      if (!inBox && !inDd) setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  const measure = useCallback(() => {
    const input = boxRef.current && boxRef.current.querySelector('input');
    if (!input) return;
    const r = input.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!results.length) { setOpen(false); return; }
    measure();
    setOpen(true);
  }, [results, measure]);

  useEffect(() => {
    if (!open) return;
    measure();
    document.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  const applyItem = (item) => {
    setSelected(item);
    setQuery(item.address ? item.address.split(',').slice(0, 3).join(',') : '');
    setJustResolved(true);
    onChange && onChange(item);
  };

  const pick = (r) => {
    setOpen(false);
    setResults([]);
    applyItem({
      address: r.address || r.display_name || r.label || '',
      lat: r.lat,
      lng: r.lng,
      provider_id: r.provider_id,
      city: r.city || '',
      state: r.state || '',
      postal_code: r.postal_code || '',
      country: r.country || ''
    });
  };

  // One-tap exact point from the device GPS. Prompts only on this click and
  // then reverse-geocodes to a readable address.
  const locateMe = async () => {
    setGeoErr('');
    setLocating(true);
    try {
      const pos = await getPosition({ interactive: true });
      if (!pos) { setGeoErr('Location unavailable. Allow access or search the address.'); return; }
      const row = await reverseGeocode(pos.lat, pos.lng).catch(() => null);
      if (row && row.address) {
        applyItem({ ...row, lat: pos.lat, lng: pos.lng });
      } else {
        const picked = await pickLocation(pos.lat, pos.lng);
        if (picked) applyItem({ ...picked, city: '', state: '', postal_code: '', country: '', provider_id: '' });
      }
    } catch {
      setGeoErr('Could not read your location. Try searching the address instead.');
    } finally {
      setLocating(false);
    }
  };

  const dropdown = open && results.length > 0 && dropPos
    ? createPortal(
        <div ref={ddRef} className="addr-dd" style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}>
          {results.map((r, i) => {
            const primary = r.label || r.address || '';
            const secondary = r.address && r.address !== primary ? r.address : '';
            const locality = [r.city, r.state, r.postal_code].filter(Boolean).join(', ');
            return (
              <button key={`${r.provider_id || i}-${i}`} type="button" className="addr-dd-item" onClick={() => pick(r)}>
                <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ minWidth: 0, display: 'grid', gap: 1 }}>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{primary}</span>
                  {secondary ? <span style={{ fontSize: 11.5, color: '#68707c' }}>{secondary}</span> : null}
                  {locality ? <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{locality}</span> : null}
                </span>
              </button>
            );
          })}
          <div className="addr-dd-foot">{provider === 'google' ? 'Powered by Google' : 'OpenStreetMap data'}</div>
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
        <input
          value={query}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Search an address, building or area…"
          data-testid="address-search"
          style={{ paddingLeft: 32, paddingRight: 40, width: '100%' }}
        />
        {loading
          ? <Loader2 size={15} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', animation: 'spin 1s linear infinite' }} />
          : (
            <button
              type="button"
              onClick={locateMe}
              disabled={locating}
              title="Use my current location"
              aria-label="Use my current location"
              data-testid="use-my-location"
              style={{ position: 'absolute', right: 6, top: 5, background: 'none', border: 'none', cursor: 'pointer', color: locating ? 'var(--muted)' : 'var(--primary)', padding: 5, display: 'flex' }}
            >
              {locating ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={15} />}
            </button>
          )}
      </div>
      {geoErr ? (
        <div role="alert" style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: '#fff1f2', color: '#be123c', fontSize: 12, fontWeight: 600 }}>
          {geoErr}
        </div>
      ) : null}
      {!loading && !justResolved && query.length >= 3 && results.length === 0 && (
        <div className="addr-dd-empty">No address matches found for “{query}”. Try a nearby landmark or check spelling.</div>
      )}
      {dropdown}
      {mapButton && (
        <button type="button" data-testid="pick-on-map" className="btn btn-outline" style={{ marginTop: 8, padding: '6px 10px', fontSize: 13 }} onClick={() => setMapOpen(true)}>
          <MapPin size={14} /> Pick on map
        </button>
      )}
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <MapPin size={13} color="#22c55e" />
          <span>{selected.address ? `Selected: ${selected.address.slice(0, 100)}${selected.address.length > 100 ? '…' : ''}` : 'Point selected on the map'}</span>
        </div>
      )}
      <MapPickerModal
        open={mapOpen}
        title="Select location on the map"
        initial={selected}
        onPick={applyItem}
        onClose={() => setMapOpen(false)}
      />
    </div>
  );
}
