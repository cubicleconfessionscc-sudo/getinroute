import React, { useEffect, useRef, useState } from 'react';
import { getGoogleMapsKey, loadGoogleMaps } from '../../lib/gmaps';
import AddressPicker from '../../components/AddressPicker';

const Row = ({ name, state, detail }) => {
  const color = state === 'pass' ? '#16a34a' : state === 'fail' ? '#dc2626' : '#94a3b8';
  const icon = state === 'pass' ? '✅' : state === 'fail' ? '❌' : '⏳';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: color }}>{name}</div>
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
      'API key present in this build',
      'Google Maps script loads',
      'Places library available',
      'Live autocomplete ("Whitefield Bangalore")',
      'Geocoder search (MapPicker Search button path)'
    ];
    setRows(tests.map((name) => ({ name, state: 'wait', detail: '' })));

    // Test 1: key
    const gmapsKey = await getGoogleMapsKey();
    set(0, tests[0], gmapsKey ? 'pass' : 'fail', gmapsKey ? `present (${gmapsKey.length} chars, starts ${gmapsKey.slice(0, 6)}…)` : 'Google Maps key is EMPTY (no VITE_GOOGLE_MAPS_API_KEY, no server /api/config/public key)');

    // Test 2: script load
    let google = null;
    try {
      google = await loadGoogleMaps();
      set(1, tests[1], google ? 'pass' : 'fail', google ? 'script loaded, google.maps namespace ready' : 'loader returned null');
    } catch (e) {
      set(1, tests[1], 'fail', String(e.message || e));
      set(2, tests[2], 'fail', 'skipped — maps not loaded');
      set(3, tests[3], 'fail', 'skipped');
      set(4, tests[4], 'fail', 'skipped');
      setRunning(false);
      return;
    }

    // Test 3: places library
    let placesLib = null;
    try {
      placesLib = await window.google.maps.importLibrary('places');
      if (!placesLib || !placesLib.AutocompleteSuggestion || !placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions) {
        await new Promise(r => setTimeout(r, 500));
        placesLib = await window.google.maps.importLibrary('places');
      }
      const ok = !!(placesLib && placesLib.AutocompleteSuggestion && placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions);
      set(2, tests[2], ok ? 'pass' : 'fail', ok ? 'importLibrary("places") OK' : 'AutocompleteSuggestion missing');
    } catch (e) {
      set(2, tests[2], 'fail', String(e.message || e));
    }

    // Test 4: live autocomplete
    try {
      const { suggestions = [] } = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: 'Whitefield Bangalore',
        includedRegionCodes: ['in']
      });
      const preds = suggestions.map((s) => s.placePrediction).filter(Boolean);
      set(3, tests[3], preds.length ? 'pass' : 'fail', preds.length ? `${preds.length} suggestions — e.g. "${preds[0].mainText?.text}, ${preds[0].secondaryText?.text || ''}"` : 'zero suggestions returned');
    } catch (e) {
      set(3, tests[3], 'fail', String(e.message || e));
    }

    // Test 5: geocoder
    try {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: 'Marathahalli, Bangalore' }, (results, status) => {
        if (status === 'OK' && results && results.length) {
          set(4, tests[4], 'pass', `${status} — "${results[0].formatted_address}"`);
        } else {
          set(4, tests[4], 'fail', `status=${status}`);
        }
        setRunning(false);
      });
    } catch (e) {
      set(4, tests[4], 'fail', String(e.message || e));
      setRunning(false);
    }
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    run(); // auto-run diagnostics on page open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 4px' }}>Google Maps Diagnostics</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
        Runs the exact same calls the address fields use, right here in your browser.
      </p>
      <button className="btn btn-primary" onClick={run} disabled={running}>
        {running ? 'Running tests…' : 'Run tests'}
      </button>
      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {rows.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>Running tests…</div>}
        {rows.map((r, i) => r && <Row key={i} {...r} />)}
      </div>

      <h3 style={{ margin: '28px 0 4px', fontSize: 16 }}>Live field sandbox</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
        This is the exact same AddressPicker component used across the app. Type “Whitefield” below — suggestions should appear as a dropdown; picking one shows its coordinates here.
      </p>
      <AddressPicker onChange={(item) => setSandboxPick(item)} />
      {sandboxPick ? (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13 }}>
          ✅ Picked: {sandboxPick.address}{sandboxPick.lat != null ? <> · lat <b>{Number(sandboxPick.lat).toFixed(5)}</b>, lng <b>{Number(sandboxPick.lng).toFixed(5)}</b></> : ''}
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13, color: 'var(--muted)' }}>
          Nothing picked yet.
        </div>
      )}
    </div>
  );
}
