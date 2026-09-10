import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, todayStr } from '../../api';
import { useAuth } from '../../auth';
import { Badge, statusColor, statusLabel, LiveMap, useInterval, Modal, useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { Users, Truck, Route as RouteIcon, CalendarClock, Activity, MapPinCheck, BellRing, ClipboardCheck, ArrowRight, Building2, LogIn, X, Trash2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from 'recharts';

const COLORS = ['#4f46e5', '#7c3aed', '#db2777', '#10b981', '#f59e0b'];

const DETAIL_TITLES = {
  employees: 'Employees',
  vehicles: 'Vehicles',
  routes: 'Routes',
  trips_today: "Today's trips",
  live_trips: 'Live trips now',
  checked_in: "Today's check-ins",
  speed_alerts: "Today's speed alerts",
  approvals: 'Pending registrations'
};

const DETAIL_LIMITS = { employees: 10000, vehicles: 750 };

const DashStatus = ({ value }) => <Badge color={statusColor(value)}>{statusLabel(value)}</Badge>;

const DETAIL_COLUMNS = {
  employees: [
    { h: 'Name', v: (r) => r.name },
    { h: 'Emp ID', v: (r) => r.emp_id },
    { h: 'Email', v: (r) => r.email },
    { h: 'Phone', v: (r) => r.phone || '—' },
    { h: 'Status', v: (r) => <DashStatus value={r.status} /> }
  ],
  vehicles: [
    { h: 'Name', v: (r) => r.vehicle_name },
    { h: 'Plate', v: (r) => r.plate },
    { h: 'Type', v: (r) => r.type },
    { h: 'Line', v: (r) => (r.line != null ? `L${r.line}` : '—') },
    { h: 'Status', v: (r) => <DashStatus value={r.status} /> }
  ],
  routes: [
    { h: 'Name', v: (r) => r.name },
    { h: 'Start', v: (r) => r.start_point },
    { h: 'End', v: (r) => r.end_point },
    { h: 'Speed limit', v: (r) => `${r.speed_limit} km/h` }
  ],
  trips_today: [
    { h: 'Vehicle', v: (r) => r.vehicleId?.vehicleNumber || '—' },
    { h: 'Driver', v: (r) => r.driverId?.name || '—' },
    { h: 'Shift', v: (r) => r.slotLabel || '—' },
    { h: 'Passengers', v: (r) => (Array.isArray(r.dropSequence) ? r.dropSequence.length : 0) },
    { h: 'Status', v: (r) => <DashStatus value={r.status} /> }
  ],
  checked_in: [
    { h: 'Employee', v: (r) => r.employeeId?.name || '—' },
    { h: 'Emp ID', v: (r) => r.employeeId?.employeeId || '—' },
    { h: 'Event', v: (r) => statusLabel(r.eventType) },
    { h: 'Method', v: (r) => r.method || 'swipe' },
    { h: 'Vehicle', v: (r) => r.vehicleNumber || '—' },
    { h: 'Time', v: (r) => r.createdAt || '—' }
  ],
  speed_alerts: [
    { h: 'Vehicle', v: (r) => r.vehicle_name },
    { h: 'Driver', v: (r) => r.driver_name },
    { h: 'Speed', v: (r) => `${Math.round(r.speed)} km/h` },
    { h: 'Limit', v: (r) => `${r.speed_limit} km/h` },
    { h: 'Time', v: (r) => r.created_at }
  ],
  approvals: [
    { h: 'Name', v: (r) => r.name },
    { h: 'Emp ID', v: (r) => r.emp_id },
    { h: 'Email', v: (r) => r.email },
    { h: 'Role', v: (r) => statusLabel(r.role) },
    { h: 'Status', v: () => <Badge color="amber">Pending</Badge> }
  ]
};

function DetailTable({ type, rows }) {
  const cols = DETAIL_COLUMNS[type] || [];
  const limited = rows.slice(0, DETAIL_LIMITS[type] || rows.length);
  return (
    <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead>
        <tbody>
          {limited.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c.h}>{c.v(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [tracking, setTracking] = useState(null);
  const [loginActivity, setLoginActivity] = useState([]);
  const [detailType, setDetailType] = useState(null);
  const [detailRows, setDetailRows] = useState([]);

  const isVendor = user?.role === 'vendor';
  const load = () => {
    if (user?.isOwner) {
      api.get('/api/owner/stats').then((s) => setStats(s && typeof s === 'object' ? s : {})).catch(() => {});
      api.get('/api/owner/login-activity?days=30').then((d) => setLoginActivity(Array.isArray(d) ? d : [])).catch(() => {});
      api.get('/api/admin/tracking').then((t) => setTracking({ vehicles: [], employees: [], speedEvents: [], ...(t && typeof t === 'object' ? t : {}) })).catch(() => {});
    } else {
      api.get('/api/admin/stats').then((s) => setStats(s && typeof s === 'object' ? s : {})).catch(() => {});
      if (!isVendor) api.get('/api/admin/schedules').then((rows) => setSchedules(Array.isArray(rows) ? rows.filter((x) => x?.date === todayStr()) : [])).catch(() => {});
      api.get('/api/admin/tracking').then((t) => setTracking({ vehicles: [], employees: [], speedEvents: [], ...(t && typeof t === 'object' ? t : {}) })).catch(() => {});
    }
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 30000);

  useSocketEvent('tracking', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    setTracking((prev) => {
      const base = prev || { vehicles: [], employees: [], speedEvents: [] };
      return {
        ...base,
        vehicles: Array.isArray(payload.vehicles) ? payload.vehicles : base.vehicles || [],
        employees: Array.isArray(payload.employees) ? payload.employees : base.employees || [],
        speedEvents: Array.isArray(payload.speedEvents) && payload.speedEvents.length ? payload.speedEvents : base.speedEvents || []
      };
    });
  });
  useSocketEvent('alert', (a) => {
    if (!a || typeof a !== 'object') return;
    if (a.vehicle_name == null || a.speed == null) return;
    setTracking((prev) => {
      if (!prev) return prev;
      const ev = {
        vehicle_name: a.vehicle_name, speed: a.speed, speed_limit: a.speed_limit,
        driver_name: a.driver_name, created_at: new Date().toLocaleString()
      };
      return { ...prev, speedEvents: [ev, ...(Array.isArray(prev.speedEvents) ? prev.speedEvents : [])].slice(0, 20) };
    });
  });
  useSocketEvent('driver:status', (payload) => {
    if (!payload || typeof payload !== 'object' || payload.vehicle_id == null) return;
    setTracking((prev) => {
      if (!prev || !Array.isArray(prev.vehicles)) return prev;
      return { ...prev, vehicles: prev.vehicles.map((v) => v.id === payload.vehicle_id ? { ...v, live_status: payload.live_status, current_stop: payload.current_stop, status: payload.status } : v) };
    });
  });

  const statusData = useMemo(() => {
    const m = {};
    schedules.forEach((s) => { m[s.status] = (m[s.status] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ name: statusLabel(k), value: v }));
  }, [schedules]);

  useEffect(() => {
    if (!detailType) return;
    const today = todayStr();
    const loaders = {
      employees: () => api.get('/api/admin/employees'),
      vehicles: () => api.get('/api/admin/vehicles'),
      routes: () => api.get('/api/admin/routes'),
      trips_today: () => api.get(`/api/admin/runs?date=${today}`),
      live_trips: () => api.get(`/api/admin/runs?date=${today}&status=in_progress`),
      checked_in: () => api.get(`/api/admin/checkin-logs?date=${today}`),
      speed_alerts: () => Promise.resolve(Array.isArray(tracking?.speedEvents) ? tracking.speedEvents : []),
      approvals: () => api.get('/api/admin/approvals')
    };
    (loaders[detailType] || (() => Promise.resolve([])))()
      .then((r) => setDetailRows(Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : []))
      .catch(() => setDetailRows([]));
  }, [detailType]);

  const delSpeedEvent = async (ev) => {
    if (!confirm(`Delete this speed alert for ${ev.vehicle_name}?`)) return;
    if (ev.id) {
      await api.del(`/api/admin/speed-events/${ev.id}`);
    } else {
      await api.del('/api/admin/speed-events');
    }
    toast('Alert deleted');
    setTracking((prev) => prev ? ({ ...prev, speedEvents: (prev.speedEvents || []).filter((s, i) => !(ev.id ? s.id === ev.id : i === 0)) }) : prev);
  };

  const routeData = useMemo(() => {
    const m = {};
    schedules.forEach((s) => { m[s.route_name || 'Unassigned'] = (m[s.route_name || 'Unassigned'] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ name: k.length > 18 ? k.slice(0, 17) + '…' : k, trips: v }));
  }, [schedules]);

  if (!stats) return <div className="empty">Loading dashboard…</div>;

  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

  if (user?.isOwner) {
    const ownerCards = [
      { icon: <Building2 size={20} />, color: 'ico-indigo', num: stats.total_companies ?? 0, lbl: 'Total Companies' },
      { icon: <LogIn size={20} />, color: 'ico-green', num: stats.companies_logged_in_today ?? 0, lbl: 'Companies Logged In Today' },
      { icon: <ClipboardCheck size={20} />, color: 'ico-amber', num: stats.pending_companies ?? 0, lbl: 'Pending Company Approvals' },
      { icon: <Users size={20} />, color: 'ico-violet', num: stats.total_employees ?? 0, lbl: 'Total Employees' },
      { icon: <LogIn size={20} />, color: 'ico-green', num: stats.employees_logged_in_today ?? 0, lbl: 'Employees Checked In Today' },
      { icon: <ClipboardCheck size={20} />, color: 'ico-pink', num: stats.pending_employees ?? 0, lbl: 'Pending Employee Approvals' },
      { icon: <Truck size={20} />, color: 'ico-blue', num: stats.total_vehicles ?? 0, lbl: 'Total Vehicles' },
      { icon: <CalendarClock size={20} />, color: 'ico-green', num: stats.trips_today ?? 0, lbl: 'Trips Today' }
    ];

    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">Platform Dashboard</div>
            <div className="page-sub">Overview of all companies, employees, trips and activity across the platform.</div>
          </div>
        </div>

        <div className="stats" style={{ marginBottom: 16 }}>
          {ownerCards.map((c, i) => (
            <div className="stat" key={i}>
              <div className={`ico ${c.color2 || c.color}`}>{c.icon}</div>
              <div className="num">{c.num}</div>
              <div className="lbl">{c.lbl}</div>
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div>
            <LiveMap
              height="380px"
              zoom={11}
              stops={[]}
              vehicles={tracking?.vehicles || []}
              employees={tracking?.employees || []}
              polyline={[]}
            />
            <div style={{ display: 'flex', gap: 18, padding: '10px 14px', background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid #e2e8f0', borderTop: 'none', fontSize: 12, fontWeight: 600, color: 'var(--slate)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                Vehicle / Cab
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                Employee
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div className="card">
              <h3>Company Overview</h3>
              {[
                { lbl: 'Approved', val: stats.approved_companies ?? 0 },
                { lbl: 'Pending', val: stats.pending_companies ?? 0 },
                { lbl: 'Logged In Today', val: stats.companies_logged_in_today ?? 0 }
              ].map((r) => (
                <div key={r.lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                  <span style={{ color: 'var(--muted)' }}>{r.lbl}</span>
                  <span style={{ fontWeight: 700 }}>{r.val}</span>
                </div>
              ))}
              <Link to="/admin/company-approvals" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 12 }}>Manage companies <ArrowRight size={14} /></Link>
            </div>
            <div className="card">
              <h3>Employee Activity</h3>
              {[
                { lbl: 'Total', val: stats.total_employees ?? 0 },
                { lbl: 'Checked In Today', val: stats.employees_logged_in_today ?? 0 },
                { lbl: 'Pending Approval', val: stats.pending_employees ?? 0 }
              ].map((r) => (
                <div key={r.lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                  <span style={{ color: 'var(--muted)' }}>{r.lbl}</span>
                  <span style={{ fontWeight: 700 }}>{r.val}</span>
                </div>
              ))}
              <Link to="/admin/employees" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginTop: 12 }}>Manage employees <ArrowRight size={14} /></Link>
            </div>
            <div className="card">
              <h3>Recent speed alerts</h3>
              {Array.isArray(tracking?.speedEvents) && tracking.speedEvents.length ? (
                tracking.speedEvents.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <Badge color="red">⚠ {Math.round(s.speed)} km/h</Badge>
                    <div style={{ fontSize: 13 }}>
                      <b>{s.vehicle_name}</b> · limit {s.speed_limit} km/h
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.driver_name}</div>
                    </div>
                  </div>
                ))
              ) : <div className="empty" style={{ padding: 12 }}>No speed alerts yet.</div>}
            </div>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
          <div className="card">
            <h3>30-Day Login Activity</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={loginActivity} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="companies" stroke="#4f46e5" strokeWidth={2} name="Companies" dot={false} />
                <Line type="monotone" dataKey="employees" stroke="#10b981" strokeWidth={2} name="Employees" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#4f46e5' }} />
                Companies
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#10b981' }} />
                Employees
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Platform Summary</h3>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              {[
                { lbl: 'Total Routes', val: stats.total_routes ?? 0, color: '#4f46e5' },
                { lbl: 'Active Trips Now', val: stats.active_trips ?? 0, color: '#10b981' },
                { lbl: 'Total Drivers', val: stats.total_drivers ?? 0, color: '#7c3aed' },
                { lbl: 'Speed Alerts Today', val: stats.alerts_today ?? 0, color: '#f59e0b' },
                { lbl: 'Checked In Today', val: stats.checked_in_today ?? 0, color: '#db2777' }
              ].map((r) => (
                <div key={r.lbl} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--slate)' }}>{r.lbl}</span>
                  <span style={{ fontWeight: 800, fontSize: 16 }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const cards = [
    { key: 'employees', icon: <Users size={20} />, color: 'ico-indigo', num: stats.employees ?? 0, lbl: `Employees (limit ${(stats.max_employees ?? 0).toLocaleString()})` },
    { key: 'vehicles', icon: <Truck size={20} />, color: 'ico-violet', num: stats.vehicles ?? 0, lbl: `Vehicles (limit ${stats.max_vehicles ?? 0})` },
    ...(isVendor ? [] : [{ key: 'routes', icon: <RouteIcon size={20} />, color: 'ico-pink', num: stats.routes ?? 0, lbl: 'Routes' }]),
    { key: 'trips_today', icon: <CalendarClock size={20} />, color: 'ico-green', num: stats.trips_today ?? 0, lbl: 'Trips today' },
    { key: 'live_trips', icon: <Activity size={20} />, color: 'ico-amber', num: stats.active_trips ?? 0, lbl: 'Live trips now' },
    { key: 'checked_in', icon: <MapPinCheck size={20} />, color: 'ico-blue', num: stats.checked_in_today ?? 0, lbl: 'Checked in today' },
    { key: 'speed_alerts', icon: <BellRing size={20} />, color: 'ico-red', num: stats.alerts_today ?? 0, lbl: 'Speed alerts today', color2: 'ico-amber' },
    ...(isVendor ? [] : [{ key: 'approvals', icon: <ClipboardCheck size={20} />, color: 'ico-green', num: stats.pending_employees ?? 0, lbl: 'Pending approvals' }])
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Operations Dashboard</div>
          <div className="page-sub">Live overview of fleet, employees, trips and safety alerts.</div>
        </div>
        <Link to="/admin/schedules" className="btn btn-primary"><CalendarClock size={16} /> Create schedule</Link>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        {cards.map((c, i) => (
          <div className="stat clickable-stat" key={i} onClick={() => setDetailType(c.key)} style={{ cursor: 'pointer', transition: 'box-shadow .15s, transform .15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 6px 18px rgba(79,70,229,.14)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
            <div className={`ico ${c.color2 || c.color}`}>{c.icon}</div>
            <div className="num">{c.num}</div>
            <div className="lbl">{c.lbl}</div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div>
          <LiveMap
            height="380px"
            zoom={11}
            stops={[]}
            vehicles={tracking?.vehicles || []}
            employees={tracking?.employees || []}
            polyline={[]}
          />
          <div style={{ display: 'flex', gap: 18, padding: '10px 14px', background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid #e2e8f0', borderTop: 'none', fontSize: 12, fontWeight: 600, color: 'var(--slate)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
              Vehicle / Cab
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
              Employee
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', border: '3px solid #f59e0b', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
              Route Stop
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <h3>Capacity usage</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Employees can scale up to 10,000 and vehicles to 750.</div>
            {[
              { lbl: 'Employees', used: stats.employees, max: stats.max_employees },
              { lbl: 'Vehicles', used: stats.vehicles, max: stats.max_vehicles }
            ].map((r) => (
              <div key={r.lbl} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  <span>{r.lbl}</span><span>{pct(r.used, r.max)}%</span>
                </div>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct(r.used, r.max)}%`, height: '100%', background: 'var(--grad)', borderRadius: 4 }} />
                </div>
              </div>
            ))}
            <Link to="/admin/employees" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Manage access <ArrowRight size={14} /></Link>
          </div>
          <div className="card">
            <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Recent speed alerts
              {!isVendor && Array.isArray(tracking?.speedEvents) && tracking.speedEvents.length > 0 && (
                <button className="btn btn-sm btn-danger" onClick={() => delSpeedEvent({})}><Trash2 size={13} /> Clear all</button>
              )}
            </h3>
            {Array.isArray(tracking?.speedEvents) && tracking.speedEvents.length ? (
              tracking.speedEvents.slice(0, 4).map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <Badge color="red">⚠ {Math.round(s.speed)} km/h</Badge>
                  <div style={{ fontSize: 13, flex: 1 }}>
                    <b>{s.vehicle_name}</b> · limit {s.speed_limit} km/h
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.driver_name} · {s.created_at}</div>
                  </div>
                  <button className="btn btn-sm btn-ghost" title="Delete alert" onClick={() => delSpeedEvent(s)}><X size={14} color="#ef4444" /></button>
                </div>
              ))
            ) : <div className="empty" style={{ padding: 12 }}>No speed alerts yet.</div>}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
        <div className="card">
          <h3>Today's trips by status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {statusData.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                {s.name} <b>({s.value})</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Today's trips by status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusData} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Trips" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <Modal open={!!detailType} onClose={() => setDetailType(null)} title={DETAIL_TITLES[detailType] || 'Details'} wide>
        {detailRows.length === 0 ? (
          <div className="empty">No records found.</div>
        ) : (
          <DetailTable type={detailType} rows={detailRows} />
        )}
      </Modal>
    </div>
  );
}
