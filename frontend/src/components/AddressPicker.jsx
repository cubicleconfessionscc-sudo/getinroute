import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Search, Loader2 } from 'lucide-react';
import { loadGoogleMaps } from '../lib/gmaps';

// Guard every external search call with a hard timeout so a hung Google/network
// request can never block the OpenStreetMap fallback. This guarantees the address
// dropdown always resolves (with results or the "no matches" hint) instead of
// appearing to do nothing when Google is slow, blocked, or misconfigured.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

function useGoogleReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((g) => { if (!cancelled && g) setReady(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return ready;
}

async function placesNewApi(google, q) {
  const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
  if (!AutocompleteSuggestion || !AutocompleteSuggestion.fetchAutocompleteSuggestions) throw new Error('new-api-unavailable');
  const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: q,
    includedRegionCodes: ['in'],
    locationBias: { center: { lat: 12.9716, lng: 77.5946 }, radius: 50000 }
  });
  return (suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      __pred: p,
      place_id: p.placeId,
      display_name: [p.mainText && p.mainText.text, p.secondaryText && p.secondaryText.text].filter(Boolean).join(', ') || 'Unnamed place'
    }));
}

function placesLegacy(google, q) {
  return new Promise((resolve, reject) => {
    if (!google || !google.maps || !google.maps.places || !google.maps.places.AutocompleteService) return reject(new Error('legacy-unavailable'));
    const service = new google.maps.places.AutocompleteService();
    const sw = new google.maps.LatLng(12.7352, 77.1000);
    const ne = new google.maps.LatLng(13.2670, 77.8555);
    service.getPlacePredictions({
      input: q,
      componentRestrictions: { country: 'in' },
      location: new google.maps.LatLngBounds(sw, ne)
    }, (preds, status) => {
      if (status !== 'OK' || !Array.isArray(preds)) return reject(new Error('legacy-status-' + status));
      resolve(preds.map((p) => ({ place_id: p.place_id, display_name: p.description })));
    });
  });
}

async function nominatim(q, cancelled) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`, {
    headers: { 'Accept-Language': 'en' }
  });
  const data = await r.json();
  if (!cancelled) return Array.isArray(data) ? data : [];
  return [];
}

export function useAddressSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [q, setQ] = useState('');
  const debounceRef = useRef(null);
  const googleReady = useGoogleReady();

  const search = useCallback((query) => {
    clearTimeout(debounceRef.current);
    if (!query || query.length < 3) { setQ(''); setResults([]); return; }
    debounceRef.current = setTimeout(() => setQ(query), 350);
  }, []);

  const clear = useCallback(() => setResults([]), []);

  useEffect(() => {
    if (!q || q.length < 3) { setResults([]); return; }
    let cancelled = false;

    const runSearch = async () => {
      setLoading(true);
      let found = null;
      if (!googleReady) { setSource('osm'); setGoogleError(''); }
      else {
        const google = window.google;
        if (google && google.maps) {
          try {
            found = await withTimeout(placesNewApi(google, q), 6000);
            if (found && found.length) { setSource('google-new'); setGoogleError(''); }
            else found = null;
          } catch (e) {
            console.warn('[GetInRoute] Places New failed:', e && e.message);
            setGoogleError(String((e && e.message) || e));
          }
          if (!found) {
            try {
              found = await withTimeout(placesLegacy(google, q), 6000);
              if (found && found.length) { setSource('google-legacy'); setGoogleError(''); }
              else found = null;
            } catch (e) {
              console.warn('[GetInRoute] Places legacy failed:', e && e.message);
              setGoogleError((g) => g || String((e && e.message) || e));
            }
          }
        }
      }

      if (cancelled) return;

      if (found && found.length) {
        console.log(`[GetInRoute] ${found.length} suggestions via ${source} for "${q}"`);
        setResults(found);
        setLoading(false);
        return;
      }

      try {
        const rows = await withTimeout(nominatim(q, cancelled), 7000);
        if (!cancelled) { setResults(rows); setSource(rows.length ? 'osm' : ''); }
      } catch { if (!cancelled) setResults([]); }
      if (!cancelled) setLoading(false);
    };

    runSearch();
    return () => { cancelled = true; };
  }, [q, googleReady]);

  return { results, loading, search, clear, source, googleError };
}

async function resolveSelection(item, google, onDone) {
  if (item.__pred) {
    try {
      const place = item.__pred.toPlace();
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
      const loc = place.location;
      return onDone({
        address: place.formattedAddress || (place.displayName && String(place.displayName)) || item.display_name,
        lat: loc ? loc.lat() : null,
        lng: loc ? loc.lng() : null
      });
    } catch {}
    return onDone({ address: item.display_name, lat: null, lng: null });
  }
  if (item.lat != null && item.lng != null) return onDone(item);
  onDone({ address: item.display_name, lat: null, lng: null });
}

export default function AddressPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value || null);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const { results, loading, search, clear, source, googleError } = useAddressSearch();
  const boxRef = useRef(null);

  const openDropdown = () => {
    const input = boxRef.current?.querySelector('input');
    if (input) {
      const r = input.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(results.length > 0);
  };

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  useEffect(() => { if (results.length) openDropdown(); else setOpen(false); }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r) => {
    setOpen(false);
    clear();
    resolveSelection(r, window.google, (item) => {
      setSelected(item);
      setQuery((item.address || '').split(',').slice(0, 3).join(','));
      onChange && onChange(item);
    });
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          placeholder="Type an address and pick from dropdown..."
          style={{ paddingLeft: 32, width: '100%' }}
        />
        {loading && <Loader2 size={15} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', animation: 'spin 1s linear infinite' }} />}
      </div>
      {!loading && query.length >= 3 && results.length === 0 && (
        <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginTop: 4 }}>
          No address matches found for “{query}”. Try a nearby landmark or check spelling.
          {googleError ? <span style={{ display: 'block', color: '#92400e', marginTop: 2 }}>Google suggestions unavailable ({googleError}) — searched OpenStreetMap instead.</span> : null}
        </div>
      )}
      {open && results.length > 0 && dropPos && (
        <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 'var(--z-dropdown)', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {results.map((r, i) => (
            <button key={`${r.place_id || i}-${i}`} type="button" onClick={() => pick(r)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '9px 12px', borderBottom: '1px solid #f1f5f9', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
              <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{r.display_name}</span>
            </button>
          ))}
          <div style={{ padding: '5px 12px', fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>
            {source === 'osm' ? 'OpenStreetMap results' : source === 'google-legacy' ? 'Google Maps (legacy)' : source === 'google-new' ? 'Google Maps' : ''}
          </div>
        </div>
      )}
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <MapPin size={13} color="#22c55e" />
          <span>Selected: {selected.address?.slice(0, 80)}{selected.address?.length > 80 ? '…' : ''}{selected.lat != null ? ` (${Number(selected.lat).toFixed(5)}, ${Number(selected.lng).toFixed(5)})` : ''}</span>
        </div>
      )}
    </div>
  );
}
