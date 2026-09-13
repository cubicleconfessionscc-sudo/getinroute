import React from 'react';
import GoogleMap from './GoogleMap';

export default function GoogleMapView({ stops = [], height = 340 }) {
  const markers = (stops || []).filter((s) => s && s.lat != null && s.lng != null)
    .map((s, i) => ({ id: `s${i}`, lat: Number(s.lat), lng: Number(s.lng), label: String(i + 1), color: 'indigo', title: s.name || `Stop ${i + 1}` }));
  const pts = markers.map((m) => ({ lat: m.lat, lng: m.lng }));
  return <GoogleMap markers={markers} lines={markers.length > 1 ? [{ path: pts, color: '#4f46e5', weight: 4 }] : []} height={height} />;
}