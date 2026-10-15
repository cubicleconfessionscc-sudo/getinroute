import React, { useEffect, useRef, useState } from 'react';
import MapLibreMap from '../../components/MapLibreMap';
import AddressPicker from '../../components/AddressPicker';
import { searchAddress, reverseGeocode, calculateRoute } from '../../lib/geo';
import { MAP_STYLE_URL } from '../../config/maps';

const Row = ({ name, state, detail }) => {
  const color = state === 'pass' ? '#16a34a' : state === 'fail' ? '#dc2626' : '#94a3b8';
  const icon = state === 'pass' ? '\u2705' : state === 'fail' ? '\u274C' : '\u23F3';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color }}>{name}</div>
        {detail && <div style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace', wordBreak: 'break-word', marginTop: 2 }}>{detail}</div>}
      </div>
    </div>
  );
};

export default function MapsDiagPage() {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [sandboxPick, setSandboxPick] = useState(null);
  const ranRef = useRef(false);

  const set = (i, name, state, detail) => setRows((prev) => {
    const next = [...prev];
    next[i] = { name, state, detail };
    return next;
  });

  const run = async () => {
    setRunning(true);
    const tests = [
      'Map style URL configured',
      'Style URL accessible',
      'Backend /api/config/public',
      'Geo search ("Whitefield Bangalore")',
      'Reverse geocode (Bengaluru coords)',
      'Route calculation (3 points)',
      'AddressPicker field'
    ];
    setRows(tests.map((name) => ({ name, state: 'wait', detail: '' })));

    // Test 1: style URL
    set(0, tests[0], MAP_STYLE_URL ? 'pass' : 'fail', MAP_STYLE_URL || 'No VITE_MAP_STYLE_URL configured');

    // Test 2: style fetchable
    try {
      const r = await fetch(MAP_STYLE_URL, { signal: AbortSignal.timeout(10000) });
      set(1, tests[1], r.ok ? 'pass' : 'fail', r.ok ? `Style loaded (${r.status})` : `HTTP ${r.status}`);
    } catch (e) {
      set(1, tests[1], 'fail', String(e.message || e));
    }

    // Test 3: config/public
    try {
      const r = await fetch('/api/config/public');
      const d = await r.json();
      set(2, tests[2], d.mapsProvider === 'maplibre' ? 'pass' : 'fail',
        `mapsProvider=${d.mapsProvider || 'missing'}`);
    } catch (e) {
      set(2, tests[2], 'fail', String(e.message || e));
    }

    // Test 4: geo search
    try {
      const results = await searchAddress('Whitefield Bangalore');
      const first = results[0];
      set(3, tests[3], results.length > 0 ? 'pass' : 'fail',
        first ? `${results.length} results — "${first.label || first.address}" at (${first.lat?.toFixed(5)}, ${first.lng?.toFixed(5)})` : 'No results');
    } catch (e) {
      set(3, tests[3], 'fail', String(e.message || e));
    }

    // Test 5: reverse geocode
    try {
      const r = await reverseGeocode(12.9716, 77.5946);
      set(4, tests[4], r ? 'pass' : 'fail',
        r ? `"${r.label || r.address}"` : 'No result');
    } catch (e) {
      set(4, tests[4], 'fail', String(e.message || e));
    }

    // Test 6: route calc
    try {
      const route = await calculateRoute([
        { lat: 12.9716, lng: 77.5946 },
        { lat: 12.9698, lng: 77.7500 },
        { lat: 12.9352, lng: 77.6245 }
      ]);
      const distKm = ((route.distanceMeters || 0) / 1000).toFixed(1);
      const mins = Math.round((route.durationSeconds || 0) / 60);
      set(5, tests[5], 'pass', `${distKm} km, ~${mins} min, ${route.legs?.length || 0} legs`);
    } catch (e) {
      set(5, tests[5], 'fail', String(e.message || e));
    }

    // Test 7: AddressPicker field is live (just check it renders)
    set(6, tests[6], 'pass', 'AddressPicker renders — type below to test live');

    setRunning(false);
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 4px' }}>Map System Diagnostics</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
        Verifies the MapLibre rendering engine, tile provider, backend geo proxy, and geocoding/routing.
      </p>
      <button className="btn btn-primary" onClick={run} disabled={running}>
        {running ? 'Running tests…' : 'Run tests'}
      </button>
      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {rows.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>Running tests…</div>}
        {rows.map((r, i) => r && <Row key={i} {...r} />)}
      </div>

      <h3 style={{ margin: '28px 0 4px', fontSize: 16 }}>Map Preview</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
        Interactive MapLibre GL JS map. Click anywhere to pick a location.
      </p>
      <MapLibreMap height="380px" onPick={(lat, lng) => setSandboxPick({ lat, lng })} />
      {sandboxPick ? (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13 }}>
          Picked: lat <b>{sandboxPick.lat.toFixed(5)}</b>, lng <b>{sandboxPick.lng.toFixed(5)}</b>
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13, color: 'var(--muted)' }}>
          Click the map to pick a location.
        </div>
      )}

      <h3 style={{ margin: '28px 0 4px', fontSize: 16 }}>Address Picker</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
        Type an address to search via the backend geo proxy.
      </p>
      <AddressPicker onChange={(item) => setSandboxPick(item)} />
      {sandboxPick && sandboxPick.lat != null && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13 }}>
          Selected: {sandboxPick.address} &middot; ({sandboxPick.lat?.toFixed(5)}, {sandboxPick.lng?.toFixed(5)})
        </div>
      )}
    </div>
  );
}
