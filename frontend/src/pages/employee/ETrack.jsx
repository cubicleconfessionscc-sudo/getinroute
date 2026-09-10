import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { LiveMap, useInterval } from '../../components/ui';
import { MapPin, Navigation } from 'lucide-react';

export default function ETrack() {
  const [allotment, setAllotment] = useState(null);
  const [address, setAddress] = useState(null);
  const load = () => {
    api.get('/api/schedules/allotments/live').then((data) => {
      setAllotment(data);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 8000);

  if (!allotment) return (
    <div className="m-card">
      <div className="empty">
        No active cab trip for you today.
        <br />
        <span style={{ fontSize: 13 }}>Once the admin confirms your schedule and allocates a cab, live tracking appears here.</span>
      </div>
    </div>
  );

  const vehicleNumber = allotment.vehicle_name || 'Cab';
  const vehicleType = allotment.type || '';
  const driverName = allotment.driver_name || 'Driver';
  const dLat = allotment.lat;
  const dLng = allotment.lng;
  const speedKmph = allotment.speed;
  const sharingLive = !!allotment.live_status && allotment.live_status !== 'idle' && allotment.live_status !== 'completed';
  const routeStops = Array.isArray(allotment.stops) ? allotment.stops : [];

  const mySequence = Number(allotment.sequence) || 1;
  const stops = routeStops.map((s, i) => ({
    lat: s.lat,
    lng: s.lng,
    name: (i + 1 === mySequence) ? `You (${s.name || 'Stop ' + (i+1)})` : (s.name || 'Stop ' + (i+1)),
    status: i + 1 === mySequence ? 'current' : (i + 1 < mySequence ? 'passed' : 'pending')
  })).filter((s) => s.lat && s.lng);

  const vehicleMarker = dLat && dLng ? [{
    id: 'cab',
    lat: dLat,
    lng: dLng,
    vehicle_name: vehicleNumber,
    plate: allotment.plate || '',
    driver_name: driverName,
    speed: speedKmph,
    route_name: allotment.route_name || ''
  }] : [];

  const center = dLat && dLng
    ? [dLat, dLng]
    : stops.length > 0 ? [stops[0].lat, stops[0].lng] : [12.9716, 77.5946];

  const myStop = routeStops[mySequence - 1] || routeStops[0] || null;

  return (
    <div>
      <div className="m-card" style={{ padding: 0 }}>
        <LiveMap
          height="380px"
          center={center}
          zoom={13}
          stops={stops}
          vehicles={vehicleMarker}
        />
      </div>
      <div className="m-card">
        <div className="m-label">Live cab position</div>
        <div className="row" style={{ alignItems: 'center' }}>
          {sharingLive && <span className="live-dot" />}
          <div style={{ flex: 1 }}>
            <b>{vehicleNumber}</b>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {vehicleType} · {driverName}
            </div>
          </div>
          {speedKmph != null && (
            <b style={{ color: 'var(--primary)' }}>{Math.round(speedKmph)} km/h</b>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: sharingLive ? 'var(--green)' : 'var(--amber)' }}>
          {sharingLive ? 'Cab is moving — live location' : "Driver hasn't started sharing location yet"}
        </div>
        {myStop && myStop.name && (
          <div style={{ marginTop: 10, background: '#f8fafc', borderRadius: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <MapPin size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <div style={{ fontSize: 14, flex: 1 }}>
              <div style={{ fontWeight: 700 }}>Your pickup stop</div>
              <div style={{ color: 'var(--slate)' }}>{myStop.name || myStop.address || 'Stop #' + mySequence}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Drop #{mySequence} of {routeStops.length} · {allotment.pickup_time || allotment.login_time || 'Shift'}
              </div>
            </div>
            {myStop.lat && myStop.lng && (
              <a
                className="btn btn-primary"
                style={{ flexShrink: 0 }}
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${myStop.lat},${myStop.lng}`}
              >
                <Navigation size={15} /> Navigate
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
