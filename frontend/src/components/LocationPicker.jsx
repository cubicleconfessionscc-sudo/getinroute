import React, { useState, useCallback, useRef } from 'react';
import { api } from '../api';
import { MapPin, Search, X } from 'lucide-react';

export default function LocationPicker({ onSelect, initialQuery = '', placeholder = 'Search location...' }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);

  const search = useCallback((q) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q || q.length < 3) { setResults([]); return; }
    timerRef.current = setTimeout(() => {
      setLoading(true);
      api.get('/api/v3/location/search', { params: { q } }).then((r) => {
        setResults(Array.isArray(r) ? r : (r && r.results ? r.results : []));
      }).catch(() => setResults([])).finally(() => setLoading(false));
    }, 300);
  }, []);

  const pick = (item) => {
    const loc = { lat: parseFloat(item.lat || item.latitude), lng: parseFloat(item.lon || item.longitude), name: item.display_name || item.name || query };
    setSelected(loc);
    setResults([]);
    if (onSelect) onSelect(loc);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <MapPin size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={query} onChange={(e) => search(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '8px 10px 8px 32px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setSelected(null); }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {loading && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Searching...</div>}
      {results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, maxHeight: 200, overflow: 'auto', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
          {results.slice(0, 8).map((r, i) => (
            <div key={i} onClick={() => pick(r)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <MapPin size={14} style={{ color: 'var(--primary)', marginTop: 2, flexShrink: 0 }} />
              <span>{r.display_name || r.name || `${r.lat}, ${r.lon}`}</span>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          Selected: <b>{selected.name}</b> ({selected.lat.toFixed(5)}, {selected.lng.toFixed(5)})
        </div>
      )}
    </div>
  );
}
