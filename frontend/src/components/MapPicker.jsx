import React from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';

function ClickCatcher({ onPick }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng)
  });
  return null;
}

export default function MapPicker({ lat, lng, onPick, height = '260px', label }) {
  const valid = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
  return (
    <div>
      <div className="map-box" style={{ height }}>
        <MapContainer
          center={valid ? [lat, lng] : [12.9716, 77.5946]}
          zoom={valid ? 14 : 11}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <ClickCatcher onPick={onPick} />
          {valid && <Marker position={[lat, lng]} />}
        </MapContainer>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
        {label || 'Tap the map to set the location.'}{' '}
        {valid ? `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}` : 'No point selected yet.'}
      </div>
    </div>
  );
}