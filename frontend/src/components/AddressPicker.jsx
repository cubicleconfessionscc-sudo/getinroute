import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search, Loader2 } from 'lucide-react';
import { searchAddress } from '../lib/geo';
import { api } from '../api';

export default function AddressPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value || null);
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('google');
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

  const dropdown = open && results.length > 0 && dropPos
    ? createPortal(
        <div ref={ddRef} className="addr-dd" style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}>
          {results.map((r, i) => (
            <button key={`${r.provider_id || i}-${i}`} type="button" className="addr-dd-item" onClick={() => pick(r)}>
              <MapPin size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{r.label || r.address}</span>
            </button>
          ))}
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
          placeholder="Type an address and pick from dropdown…"
          data-testid="address-search"
          style={{ paddingLeft: 32, width: '100%' }}
        />
        {loading && <Loader2 size={15} style={{ position: 'absolute', right: 10, top: 11, color: 'var(--muted)', animation: 'spin 1s linear infinite' }} />}
      </div>
      {!loading && query.length >= 3 && results.length === 0 && (
        <div className="addr-dd-empty">No address matches found for “{query}”. Try a nearby landmark or check spelling.</div>
      )}
      {dropdown}
      {selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <MapPin size={13} color="#22c55e" />
          <span>{selected.address ? `Selected: ${selected.address.slice(0, 100)}${selected.address.length > 100 ? '…' : ''}` : 'Point selected on the map'}</span>
        </div>
      )}
    </div>
  );
}
