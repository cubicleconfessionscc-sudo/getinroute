import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { LiveMap, useInterval, Badge } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { Truck, Users, BellRing, Building2, MapPin, Clock, UserCheck, Download } from 'lucide-react';

export default function LiveTracking() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [health, setHealth] = useState(null);

  const focusOn = (lat, lng) => {
    if (lat && lng) setFocus({ lat: Number(lat), lng: Number(lng), ts: Date.now() });
  };

  const exportEmployees = () => {
    const emps = data?.employees || [];
    const headers = ['Employee Name', 'Employee ID', 'Phone', 'Department', 'Last Known Address', 'Latitude', 'Longitude', 'Last Update', 'Drop Details'];
    const rows = emps.map((e) => [
      e.name || '', e.emp_id || '', e.phone || '', e.department || '',
      e.home_address || '', e.lat ?? '', e.lng ?? '', e.last_update || '',
      e.drop_details || (e.lat && e.lng ? `Tracked at (${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)})` : '')
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `employee-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const isVendor = user?.role === 'vendor';
  const load = () => {
    if (!isVendor && user?.isOwner) {
      api.get('/api/owner/tracking').then((t) => setData({ vehicles: [], employees: [], routes: [], speedEvents: [], companies: [], ...(t && typeof t === 'object' ? t : {}) })).catch(() => {});
    } else {
      api.get('/api/admin/tracking').then((t) => setData({ vehicles: [], employees: [], routes: [], speedEvents: [], ...(t && typeof t === 'object' ? t : {}) })).catch(() => {});
    }
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 15000);

  const loadHealth = () => {
    const url = !isVendor && user?.isOwner ? '/api/owner/realtime-health' : '/api/admin/realtime-health';
    api.get(url).then(setHealth).catch(() => {});
  };
  useEffect(() => { loadHealth(); }, []);
  useInterval(loadHealth, 20000);
  useSocketEvent('realtime:health', (p) => { if (p && typeof p === 'object') setHealth(p); });

  useSocketEvent('tracking', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    setData((prev) => {
      const base = prev || { vehicles: [], employees: [], routes: [], speedEvents: [] };
      return {
        ...base,
        vehicles: Array.isArray(payload.vehicles) ? payload.vehicles : base.vehicles,
        speedEvents: Array.isArray(payload.speedEvents) && payload.speedEvents.length ? payload.speedEvents : base.speedEvents
      };
    });
  });

  useSocketEvent('driver:status', (payload) => {
    if (!payload || typeof payload !== 'object' || payload.vehicle_id == null) return;
    setData((prev) => {
      if (!prev || !Array.isArray(prev.vehicles)) return prev;
      return {
        ...prev,
        vehicles: prev.vehicles.map((v) => v.id === payload.vehicle_id
          ? { ...v, live_status: payload.live_status, current_stop: payload.current_stop, status: payload.status }
          : v)
      };
    });
  });

  if (!data) return <div className="empty">Loading live tracking…</div>;

  const allVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const vehicles = filter === 'all' ? allVehicles : filter === 'moving' ? allVehicles.filter((v) => v.status === 'active') : allVehicles.filter((v) => v.status === 'idle');
  const shown = selected && selected._type === 'vehicle' ? vehicles.filter((v) => v.id === selected.id) : vehicles;
  const companies = Array.isArray(data.companies) ? data.companies : [];
  const companyMarkers = companies.filter((c) => c.lat && c.lng).map((c) => ({
    ...c, id: `company-${c.id}`, lat: c.lat, lng: c.lng,
    vehicle_name: c.department || c.name, driver_name: `Last login: ${c.last_login || 'Never'}`,
    plate: c.email, status: 'idle', speed: 0, type: 'company',
    line: 0, trip: 0, live_status: 'company'
  }));

  const gpsBadge = (v) => {
    const s = v.gps_status;
    if (s === 'live') return <Badge color="green">GPS live</Badge>;
    if (s === 'stale') return <Badge color="amber">GPS stale<span style={{ fontWeight: 400 }}> · {v.last_ping_ago_sec ?? '—'}s ago</span></Badge>;
    if (s === 'reconnecting') return <Badge color="amber">Reconnecting</Badge>;
    return <Badge color="slate">GPS off</Badge>;
  };

  const healthBanner = health ? (() => {
    const used = health.used ?? 0;
    const limit = health.limit ?? 0;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const intervalSec = health.interval?.intervalSec ?? 60;
    const activeDrivers = health.activeDrivers ?? 0;
    const overTier = activeDrivers > (health.upgradeThreshold ?? 180);
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', borderLeft: overTier ? '4px solid #f59e0b' : '4px solid var(--green)' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: overTier ? '#f59e0b' : 'var(--text)' }}>{activeDrivers}</div>
          <div>active drivers</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{intervalSec} s</div>
          <div>GPS ping interval</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 130 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: pct > 80 ? '#ef4444' : 'var(--text)' }}>{pct}%</div>
          <div>realtime budget used</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ height: 8, borderRadius: 6, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
            {used.toLocaleString()} / {limit.toLocaleString()} messages {health.month ? `· ${health.month}` : ''}
          </div>
        </div>
        {overTier && (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '4px 10px', borderRadius: 999 }}>
            {intervalSec >= 300 ? 'Heavy load — consider scaling up' : `Upgrade when over ${health.upgradeThreshold ?? 180} drivers`}
          </span>
        )}
      </div>
    );
  })() : null;

  if (user?.isOwner) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">Live Tracking</div>
            <div className="page-sub">Companies, vehicles, and employees in real time.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['all', 'All'], ['companies', 'Companies'], ['moving', 'On Trip'], ['idle', 'Idle']].map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setFilter(k); setSelected(null); }}>{l}</button>
            ))}
        </div>
      </div>

      {healthBanner}

      <div className="grid" style={{ gridTemplateColumns: '1fr 340px' }}>
          <LiveMap height="calc(100vh - 220px)" zoom={11}
            focus={focus}
            vehicles={filter === 'companies' ? companyMarkers : [...shown, ...companyMarkers]}
            employees={data.employees || []}
            stops={(Array.isArray(data.routes) ? data.routes : []).flatMap((r) => (Array.isArray(r?.stops) ? r.stops : []))}
            polyline={[]}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            {filter !== 'companies' && (
              <div className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}><Truck size={16} color="#4f46e5" /> Vehicles ({vehicles.length})</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tap a vehicle to isolate it on the map.</div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {vehicles.slice(0, 20).map((v) => (
                    <button key={v.id} onClick={() => setSelected(selected?.id === v.id && selected?._type === 'vehicle' ? null : { ...v, _type: 'vehicle' })}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 10, background: selected?.id === v.id && selected?._type === 'vehicle' ? 'var(--grad-soft)' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: v.status === 'active' ? 'var(--green)' : '#cbd5e1', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{v.vehicle_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.plate} · L{v.line} T{v.trip} · {v.driver_name}</div>
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <Badge color={v.status === 'active' ? 'green' : 'slate'}>{v.status === 'active' ? `${Math.round(v.speed || 0)} km/h` : 'Idle'}</Badge>
                        {v.live_status && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{String(v.live_status).replace(/_/g, ' ')}</div>}
                    {gpsBadge(v)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                <Building2 size={16} color="#4f46e5" /> Companies ({companies.length})
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Green dot = logged in today.</div>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                {companies.map((c) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const loggedInToday = c.last_login && c.last_login.startsWith(today);
                  return (
                    <div key={c.id} style={{ padding: '10px 12px', background: filter === 'companies' ? 'var(--grad-soft)' : '#f8fafc', borderRadius: 10, borderLeft: `3px solid ${loggedInToday ? 'var(--green)' : '#cbd5e1'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: loggedInToday ? 'var(--green)' : '#cbd5e1', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{c.department || c.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email}</div>
                        </div>
                        {c.lat && c.lng && <MapPin size={14} color="var(--primary)" />}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                        <span><UserCheck size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{c.total_employees ?? 0} emp</span>
                        <span><Truck size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{c.total_vehicles ?? 0} veh</span>
                        <span><Clock size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />{c.last_login ? new Date(c.last_login).toLocaleString() : 'Never'}</span>
                      </div>
                    </div>
                  );
                })}
                {companies.length === 0 && <div className="empty" style={{ padding: 12 }}>No companies yet.</div>}
              </div>
            </div>

            {(data.speedEvents || []).length > 0 && (
              <div className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}><BellRing size={16} color="#ef4444" /> Speed violations</div>
                {(data.speedEvents || []).slice(0, 6).map((s, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
                    <b>{s.vehicle_name}</b> — {Math.round(s.speed)} km/h (limit {s.speed_limit})<div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.driver_name} · {s.created_at}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Live Tracking</div>
          <div className="page-sub">Click a driver, vehicle or employee name to locate them on the map.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['all', 'All'], ['moving', 'On Trip'], ['idle', 'Idle']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setFilter(k); setSelected(null); }}>{l}</button>
          ))}
          {!isVendor && <button className="btn btn-sm btn-green" onClick={exportEmployees}><Download size={14} /> Export Excel</button>}
        </div>
      </div>

      {healthBanner}

      <div className="grid" style={{ gridTemplateColumns: '1fr 340px' }}>
        <LiveMap height="calc(100vh - 220px)" zoom={11}
          focus={focus}
          vehicles={shown}
          employees={data.employees || []}
          stops={(Array.isArray(data.routes) ? data.routes : []).flatMap((r) => (Array.isArray(r?.stops) ? r.stops : []))}
          polyline={[]}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}><Truck size={16} color="#4f46e5" /> Vehicles ({vehicles.length})</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tap a vehicle name to find its cab on the map.</div>
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {vehicles.slice(0, 30).map((v) => (
                <button key={v.id} onClick={() => { setSelected(selected?.id === v.id ? null : v); focusOn(v.lat, v.lng); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 10, background: selected?.id === v.id ? 'var(--grad-soft)' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: v.status === 'active' ? 'var(--green)' : '#cbd5e1', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{v.vehicle_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Driver: <b style={{ color: 'var(--primary)' }} onClick={(e) => { e.stopPropagation(); focusOn(v.lat, v.lng); }}>{v.driver_name || '—'}</b> · L{v.line} T{v.trip}
                    </div>
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <Badge color={v.status === 'active' ? 'green' : 'slate'}>{v.status === 'active' ? `${Math.round(v.speed || 0)} km/h` : 'Idle'}</Badge>
                    {v.live_status && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{String(v.live_status).replace(/_/g, ' ')}</div>}
                    {gpsBadge(v)}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}><Users size={16} color="#10b981" /> Employees on shift ({(data.employees || []).length})</div>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {(data.employees || []).map((e) => (
                <button key={e.id} onClick={() => focusOn(e.lat, e.lng)} title="Show on map"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#f8fafc', borderRadius: 9, cursor: 'pointer', border: '1.5px solid transparent' }}
                  onMouseEnter={(ev) => ev.currentTarget.style.borderColor = 'var(--green)'}
                  onMouseLeave={(ev) => ev.currentTarget.style.borderColor = 'transparent'}>
                  <span className="live-dot" />
                  <div style={{ flex: 1, fontSize: 13, textAlign: 'left' }}><b>{e.name}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.emp_id} · {e.department}</div></div>
                  {(e.lat && e.lng) && <MapPin size={13} color="#10b981" />}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{e.last_update?.slice(11, 16)}</span>
                </button>
              ))}
              {(data.employees || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No employees checked in yet.</div>}
            </div>
          </div>
          {(data.speedEvents || []).length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 4 }}><BellRing size={16} color="#ef4444" /> Speed violations</div>
              {(data.speedEvents || []).slice(0, 8).map((s, i) => (
                <div key={i} onClick={() => focusOn(s.lat, s.lng)} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12, cursor: 'pointer' }}>
                  <b>{s.vehicle_name}</b> — {Math.round(s.speed)} km/h (limit {s.speed_limit})<div style={{ color: 'var(--muted)', fontSize: 11 }}>{s.driver_name} · {s.created_at}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
