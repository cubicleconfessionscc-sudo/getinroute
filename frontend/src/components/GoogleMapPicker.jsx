import React, { useEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { api } from '../api';
import MapPicker from './MapPicker';
import AddressPicker from './AddressPicker';

/* Google Maps location picker for Admin/Vendor route planning. Tap the map or
   drag the pin to choose a point. Falls back to the MapLibre picker when no
   browser key is configured (dashboard/live tracking always stay MapLibre). */
let mapsLoader = null;
function loadGoogleMaps(key) {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
    s.async = true;
    s.onload = () => resolve(window.google.maps);
    s.onerror = () => reject(new Error('google-maps-load-failed'));
    document.head.appendChild(s);
  });
  return mapsLoader;
}

export default function GoogleMapPicker({ lat, lng, onPick, height = 300, label }) {
  const [key, setKey] = useState(null);
  const [failed, setFailed] = useState(false);
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const emitRef = useRef(onPick);
  emitRef.current = onPick;

  useEffect(() => {
    let alive = true;
    api.get('/api/config/public').then((c) => { if (alive) setKey(c && c.googleMapsKey ? c.googleMapsKey : null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!key || failed) return;
    let cancelled = false;
    loadGoogleMaps(key).then((maps) => {
      if (cancelled || !divRef.current) return;
      const hasPoint = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
      const center = hasPoint ? { lat: Number(lat), lng: Number(lng) } : { lat: 12.9716, lng: 77.5946 };
      if (!mapRef.current) {
        mapRef.current = new maps.Map(divRef.current, { center, zoom: hasPoint ? 14 : 11, mapTypeControl: false, streetViewControl: false });
        markerRef.current = new maps.Marker({ position: center, map: mapRef.current, draggable: true });
        markerRef.current.addListener('dragend', (e) => emitRef.current && emitRef.current(e.latLng.lat(), e.latLng.lng()));
        mapRef.current.addListener('click', (e) => {
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          if (markerRef.current) markerRef.current.setPosition(p);
          if (emitRef.current) emitRef.current(p.lat, p.lng);
        });
      } else if (hasPoint) {
        const p = { lat: Number(lat), lng: Number(lng) };
        mapRef.current.panTo(p);
        if (markerRef.current) markerRef.current.setPosition(p);
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [key, failed, lat, lng]);

  if (!key || failed) {
    return <MapPicker lat={lat} lng={lng} onPick={onPick} height={height} label={label} />;
  }

  const useMyLocation = () => {
    if (!navigator.geolocation || !onPick) return;
    navigator.geolocation.getCurrentPosition(
      (p) => onPick(p.coords.latitude, p.coords.longitude),
      () => {},
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" style={{ padding: '6px 10px', fontSize: 13 }} onClick={useMyLocation}>
          <LocateFixed size={14} /> Use my location
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AddressPicker
            value={lat != null ? { address: '', lat, lng } : null}
            onChange={(item) => { if (item && item.lat != null && item.lng != null && onPick) onPick(item.lat, item.lng); }}
          />
        </div>
      </div>
      <div ref={divRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden' }} />
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
        {label || 'Tap the map or drag the pin to set the location.'}
      </div>
    </div>
  );
}
