import React, { useRef, useState, useEffect, useCallback } from 'react';
import { MapPin, Search, Loader2 } from 'lucide-react';
import { searchAddress } from '../lib/geo';

export default function AddressPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value || null);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);

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
    clearTimeout(debounceRef.current);
    if (v.length >= 3) debounceRef.current = setTimeout(() => doSearch(v), 350);
    else setResults([]);
  };

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, []);

  useEffect(() => { if (results.length) openDropdown(); else setOpen(false); }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDropdown = () => {
    const input = boxRef.current?.querySelector('input');
    if (input) {
      const r = input.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(results.length > 0);
  };

  const pick = (r) => {
    setOpen(false);
    setResults([]);
    const item = {
      address: r.address || r.display_name || r.label || '',
      lat: r.lat,
      lng: r.lng,
      provider_id: r.provider_id,
      city: r.city || '',
      state: r.state || '',
      postal_code: r.postal_code || '',
      country: r.country || ''
    };
    setSelected(item);
    setQuery(item.address.split(',').slice(0, 3).join(','));
    onChange && onChange(item);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
        <input
          value={query}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Type an address and pick from dropdown\u2026"
          style={{ paddingLeft: 32, width: '100%' }}
        />
        {loading && <Loader2 size={15} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', animation: 'spin 1s linear infinite' }} />}
      </div>
      {!loading && query.length >= 3 && results.length === 0 && (
        <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginTop: 4 }}>
          No address matches found for \u201c{query}\u201d. Try a nearby landmark or check spelling.
        </div>
      )}
      {open && results.length > 0 && dropPos && (
        <div style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 'var(--z-dropdown, 900)', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {results.map((r, i) => (
            <button key={`${r.provider_id || i}-${i}`} type="button" onClick={() => pick(r)}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '9px 12px', borderBottom: '1px solid #f1f5f9', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
              <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{r.label || r.address}</span>
            </button>
          ))}
          <div style={{ padding: '5px 12px', fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>OpenStreetMap data</div>
        </div>
      )}
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <MapPin size={13} color="#22c55e" />
          <span>Selected: {selected.address?.slice(0, 80)}{selected.address?.length > 80 ? '\u2026' : ''}{selected.lat != null ? ` (${Number(selected.lat).toFixed(5)}, ${Number(selected.lng).toFixed(5)})` : ''}</span>
        </div>
      )}
    </div>
  );
}
