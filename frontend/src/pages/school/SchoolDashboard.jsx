import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useInterval, LiveMap, Badge, useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import {
  Users, Truck, Route as RouteIcon, CalendarClock, ShieldAlert, CheckCircle2,
  UserX, Bus, ArrowRight
} from 'lucide-react';

export default function SchoolDashboard() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [tracking, setTracking] = useState([]);
  const [school, setSchool] = useState(null);
  const [me, setMe] = useState(null);

  const load = () => {
    api.get('/api/school/stats').then((r) => setStats(r)).catch(() => {});
    api.get('/api/school/tracking').then((r) => setTracking(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/school/me').then((r) => { setMe(r); if (r?.school) setSchool(r.school); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 20000);
  useSocketEvent('sos:new', () => { load(); });

  if (!stats) return <div className="empty">Loading dashboard…</div>;

  const t = stats.today || {};
  const settings = stats.settings || {};
  const vehicles = tracking.map((v) => ({ ...v, type: 'school' }));
  const allStops = tracking.flatMap((v) => v.stops || []);

  const cards = [
    { icon: <Users />, color: 'indigo', num: me?.stats?.students ?? stats.students ?? 0, lbl: 'Students' },
    { icon: <Bus />, color: 'violet', num: me?.stats?.drivers ?? 0, lbl: 'Drivers' },
    { icon: <Truck />, color: 'pink', num: me?.stats?.vehicles ?? 0, lbl: 'Vehicles' },
    { icon: <RouteIcon />, color: 'blue', num: me?.stats?.routes ?? 0, lbl: 'Routes' },
    { icon: <CalendarClock />, color: 'green', num: t.trips ?? 0, lbl: "Today's trips" },
    { icon: <CheckCircle2 />, color: 'amber', num: t.boarded ?? 0, lbl: 'Boarded today' },
    { icon: <CheckCircle2 />, color: 'green', num: t.drop_confirmed ?? 0, lbl: 'Drops confirmed' },
    { icon: <ShieldAlert />, color: 'red', num: me?.stats?.open_sos ?? 0, lbl: 'Open SOS' }
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">{school?.name || 'School Dashboard'} · {stats.date}</div>
          <div className="page-sub">Live overview of buses, students and safety today.</div>
        </div>
        {settings.displayName && <Badge color="pink">{settings.displayName}</Badge>}
      </div>

      <div className="stats">
        {cards.map((c) => (
          <div className="stat" key={c.lbl}>
            <div className={`ico ico-${c.color}`}>{c.icon}</div>
            <div className="num">{c.num}</div>
            <div className="lbl">{c.lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0' }}>
        <Link to="/school/schedules" className="btn btn-primary"><CalendarClock size={16} /> Manage schedules</Link>
        <Link to="/school/students" className="btn btn-outline"><Users size={16} /> Students</Link>
        <Link to="/school/sos" className="btn btn-outline"><ShieldAlert size={16} color="#ef4444" /> SOS queue</Link>
      </div>

      <div className="grid">
        <div className="card">
          <div className="row">
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Live buses</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tracking.length} vehicles on your fleet</div>
            </div>
            <div className="sp" />
            <Link to="/school/schedules" className="btn btn-sm btn-ghost">Schedules <ArrowRight size={14} /></Link>
          </div>
          <div style={{ marginTop: 14 }}>
            <LiveMap center={allStops[0] ? [allStops[0].lat, allStops[0].lng] : [12.9716, 77.5946]} vehicles={vehicles} stops={allStops} height="380px" />
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Today at a glance</div>
          {[
            { label: 'Boardings recorded', value: t.boarded ?? 0 },
            { label: 'Dropped by driver', value: t.dropped ?? 0 },
            { label: 'Parent-confirmed drops', value: t.drop_confirmed ?? 0 },
            { label: 'Marked absent', value: t.absent ?? 0 },
            { label: 'Missed boarding window', value: t.missed ?? 0 }
          ].map((row) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 2px', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 13, color: 'var(--slate)' }}>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <div className="m-label" style={{ marginBottom: 8 }}>Bus status legend</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip"><span className="live-dot" /> Live</span>
              <span className="chip">🛑 Stand-by</span>
              <span className="chip">✔ Verified driver</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}