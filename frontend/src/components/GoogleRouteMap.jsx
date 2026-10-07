import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import MapLibreMap from './MapLibreMap';

/* Google Maps JS map used ONLY for Admin/Vendor route planning. Falls back to
   the existing MapLibre/OSM map when no browser key is configured, so the page
   never breaks. The dashboard + live tracking keep using MapLibre/OSM. */
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

export default function GoogleRouteMap({ markers = [], lines = [], height = 300, onMarkerDrag }) {
  const [key, setKey] = useState(null);
  const [failed, setFailed] = useState(false);
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const objsRef = useRef([]);

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
      if (!mapRef.current) {
        mapRef.current = new maps.Map(divRef.current, { center: { lat: 12.9716, lng: 77.5946 }, zoom: 11, mapTypeControl: false, streetViewControl: false });
      }
      // clear old overlays
      objsRef.current.forEach((o) => o.setMap && o.setMap(null));
      objsRef.current = [];
      const bounds = new maps.LatLngBounds();
      const any = markers.length > 0;
      markers.forEach((m) => {
        const pos = { lat: Number(m.lat), lng: Number(m.lng) };
        if (!isFinite(pos.lat) || !isFinite(pos.lng)) return;
        bounds.extend(pos);
        const color = { green: '#22c55e', red: '#ef4444', amber: '#f59e0b', violet: '#8b5cf6', blue: '#3b82f6' }[m.color] || '#f59e0b';
        const marker = new maps.Marker({ position: pos, map: mapRef.current, label: m.label || undefined, title: m.title || '', draggable: !!onMarkerDrag });
        if (onMarkerDrag) marker.addListener('dragend', (e) => onMarkerDrag(m.id, e.latLng.lat(), e.latLng.lng()));
        objsRef.current.push(marker);
      });
      (lines || []).forEach((l) => {
        const path = (l.path || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })).filter((p) => isFinite(p.lat) && isFinite(p.lng));
        if (path.length > 1) objsRef.current.push(new maps.Polyline({ path, map: mapRef.current, strokeColor: l.color || '#f59e0b', strokeWeight: l.weight || 4, strokeOpacity: l.opacity ?? 0.9 }));
      });
      if (any && bounds.isEmpty() === false) mapRef.current.fitBounds(bounds, 48);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [key, failed, markers, lines, onMarkerDrag]);

  // No key yet / load failed -> keep the working MapLibre map.
  if (!key || failed) {
    return <MapLibreMap markers={markers} lines={lines} height={height} onMarkerDrag={onMarkerDrag} />;
  }
  return <div ref={divRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden' }} />;
}
