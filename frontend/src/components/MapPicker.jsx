import React, { useEffect, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import MapLibreMap from './MapLibreMap';
import AddressPicker from './AddressPicker';
import LocationText from './LocationText';
import { resolveAddress } from '../lib/geo';

export default function MapPicker({ lat, lng, onPick, height = '260px', label }) {
  const [cur, setCur] = useState({ lat: lat ?? null, lng: lng ?? null });
  const valid = cur.lat != null && cur.lng != null && !isNaN(cur.lat) && !isNaN(cur.lng);
  const [addr, setAddr] = useState('');
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoErr, setGeoErr] = useState('');

  useEffect(() => {
    setCur({ lat: lat ?? null, lng: lng ?? null });
  }, [lat, lng]);

  const emit = (la, ln) => {
    if (la == null || ln == null) return;
    const point = { lat: Number(la), lng: Number(ln) };
    setCur(point);
    // Name the point so users never have to read raw coordinates.
    setAddr('');
    resolveAddress(point.lat, point.lng)
      .then((a) => { if (a) setAddr(a); })
      .catch(() => {});
    if (onPick) onPick(point.lat, point.lng);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return setGeoErr('Geolocation is not supported in this browser.');
    setGeoLocating(true);
    setGeoErr('');
    navigator.geolocation.getCurrentPosition(
      (p) => { setGeoLocating(false); emit(p.coords.latitude, p.coords.longitude); },
      () => { setGeoLocating(false); setGeoErr('Could not get your location — check browser permission.'); },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" style={{ padding: '6px 10px', fontSize: 13 }} onClick={useMyLocation} disabled={geoLocating}>
          <LocateFixed size={14} /> {geoLocating ? 'Locating…' : 'Use my location'}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AddressPicker
            value={valid ? { address: addr, lat: cur.lat, lng: cur.lng } : null}
            onChange={(item) => { if (item && item.lat != null && item.lng != null) { emit(item.lat, item.lng); } }}
          />
        </div>
      </div>
      {geoErr && <div style={{ fontSize: 12, color: '#ef4444', margin: '0 0 6px' }}>{geoErr}</div>}
      <MapLibreMap
        center={cur.lat != null ? { lat: Number(cur.lat), lng: Number(cur.lng) } : null}
        zoom={valid ? 14 : 11}
        markers={valid ? [{ id: 'pick', lat: Number(cur.lat), lng: Number(cur.lng), color: 'indigo' }] : []}
        onPick={(la, ln) => emit(la, ln)}
        onMarkerDrag={(id, la, ln) => emit(la, ln)}
        height={height}
        fit={false}
      />
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
        {label || 'Tap the map or drag the pin to set the location.'}{' '}
        {valid
          ? <LocationText lat={cur.lat} lng={cur.lng} address={addr} max={120} />
          : 'No point selected yet.'}
      </div>
    </div>
  );
}
