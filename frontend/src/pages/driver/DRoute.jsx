import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { LiveMap, useInterval, Badge } from '../../components/ui';
import { MapPin } from 'lucide-react';

export default function DRoute() {
  const [data, setData] = useState(null);
  const load = () => api.get('/api/driver/today').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 5000);

  if (!data?.route) return <div className="m-card"><div className="empty">No route assigned yet.</div></div>;

  const vehicles = data.vehicle?.lat ? [data.vehicle] : [];

  return (
    <div>
      <div className="m-card" style={{ padding: 0 }}>
        <LiveMap height="380px" zoom={12} stops={data.route.stops} vehicles={vehicles} polyline={[]} />
      </div>
      <div className="m-card">
        <div className="m-label">Pickup / drop sequence</div>
        {(Array.isArray(data.route.stops) ? data.route.stops : []).map((stop, i) => {
          const atStop = (Array.isArray(data.schedules) ? data.schedules : []).filter((s) => ((Array.isArray(data.route.stops) ? data.route.stops : [])[Math.max(0, (Array.isArray(data.schedules) ? data.schedules : []).length - 1)]?.sequence || 1) === stop.sequence);
          return (
            <div key={stop.sequence} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: i === 0 ? '#10b981' : 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{stop.sequence}</div>
                {i < (Array.isArray(data.route.stops) ? data.route.stops : []).length - 1 && <div style={{ width: 2, height: '100%', background: '#e2e8f0', margin: '0 auto' }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{stop.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {i === 0 ? 'Start point' : i === data.route.stops.length - 1 ? 'End / drop point' : 'Pickup stop'}
                </div>
                {atStop.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {(Array.isArray(data.schedules) ? data.schedules : []).filter((s) => s.sequence === stop.sequence).map((s) => {
                      const c = (Array.isArray(s.checkins) ? s.checkins : []).find((x) => x.type === 'checkin');
                      return (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <MapPin size={14} color="#64748b" />
                          <span style={{ fontSize: 13 }}><b>{s.name}</b> · {s.pickup_time}</span>
                          <div style={{ marginLeft: 'auto' }}>{c ? <Badge color="green">✓ onboard</Badge> : <Badge color="slate">waiting</Badge>}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
