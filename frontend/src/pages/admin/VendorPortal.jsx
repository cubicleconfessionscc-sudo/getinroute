import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, statusColor, statusLabel, useInterval, useToast } from '../../components/ui';
import { Truck, Route as RouteIcon, AlertTriangle, Bus, Plus, Pencil, Trash2, Users } from 'lucide-react';

export default function VendorPortal() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  const load = () => {
    api.get('/api/vendor/dashboard').then((r) => setStats(r && typeof r === 'object' ? r : null)).catch(() => {});
    api.get('/api/vendor/routes').then((r) => setRoutes(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/vendor/vehicles').then((r) => setVehicles(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/vendor/trips').then((r) => setTrips(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/vendor/employees').then((r) => setEmployees(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/vendor/drivers').then((r) => setDrivers(Array.isArray(r) ? r.filter((d) => d.approved === 1) : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 15000);

  const pickDriver = (id) => {
    const d = drivers.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, driver_id: id, driver_name: d ? d.name : (f.driver_name || ''), driver_phone: d ? (d.phone || '') : (f.driver_phone || '') }));
  };

  const openEdit = (v) => {
    setEditing(v ? v.id : null);
    const linked = drivers.find((x) => x.phone && v?.driver_phone && x.phone === v.driver_phone);
    setForm(v
      ? { vehicle_name: v.vehicle_name, plate: v.plate, type: v.type, capacity: v.capacity, stand: v.stand || '', driver_name: v.driver_name, driver_phone: v.driver_phone, driver_id: linked ? String(linked.id) : '' }
      : { vehicle_name: '', plate: '', type: 'Sedan', capacity: 4, stand: '', driver_name: '', driver_phone: '', driver_id: '' });
    setModal(true);
  };
  const save = async () => {
    if (!form.vehicle_name) return toast('Vehicle name required');
    if (editing) await api.put(`/api/vendor/vehicles/${editing}`, form);
    else await api.post('/api/vendor/vehicles', form);
    toast(editing ? 'Vehicle updated' : 'Vehicle added');
    setModal(false);
    load();
  };
  const del = async (v) => {
    if (!confirm(`Remove ${v.vehicle_name}?`)) return;
    await api.del(`/api/admin/vehicles/${v.id}`);
    toast('Removed');
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Vendor Dashboard</div>
          <div className="page-sub">Your fleet, your trips — scoped to your vendor account only.</div>
        </div>
        <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add Vehicle</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="ico ico-indigo"><Truck size={20} /></div><div className="num">{stats?.vehicles ?? '—'}</div><div className="lbl">My Vehicles</div></div>
        <div className="stat"><div className="ico ico-green"><Bus size={20} /></div><div className="num">{stats?.on_trip ?? '—'}</div><div className="lbl">On Trip Now</div></div>
        <div className="stat"><div className="ico ico-blue"><RouteIcon size={20} /></div><div className="num">{stats?.trips_today ?? '—'}</div><div className="lbl">Trips Today</div></div>
        <div className="stat"><div className="ico ico-red"><AlertTriangle size={20} /></div><div className="num">{stats?.alerts_today ?? '—'}</div><div className="lbl">Speed Alerts</div></div>
      </div>

      <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>My Fleet</h3>
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Vehicle</th><th>Plate</th><th>Type</th><th>Stand</th><th>Driver</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.vehicle_name}</b></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.plate || '—'}</td>
                  <td>{v.type || '—'}</td>
                  <td>{v.stand || '—'}</td>
                  <td>{v.driver_name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.driver_phone}</div></td>
                  <td><Badge color={statusColor(v.status)}>{statusLabel(v.status)}</Badge></td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(v)}><Pencil size={13} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(v)}><Trash2 size={13} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!vehicles.length && <tr><td colSpan={7} className="empty">No vehicles yet. Add your first one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>My Employees (allotted by admin)</h3>
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>ID</th><th>Phone</th><th>Department / Area</th><th>Address</th><th>Vehicle</th><th>Status</th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td><b>{e.name}</b></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.emp_id}</td>
                  <td>{e.phone || '—'}</td>
                  <td>{e.department || '—'}</td>
                  <td style={{ fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.home_address || '—'}</td>
                  <td>{e.vehicle_name || '—'}</td>
                  <td><Badge color={e.approved ? 'green' : 'amber'}>{e.approved ? 'Active' : 'Pending'}</Badge></td>
                </tr>
              ))}
              {!employees.length && <tr><td colSpan={7} className="empty">No employees allotted to you yet. The company admin assigns employees to your vendor account.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>My Assigned Routes</h3>
      <div className="card">
        {routes.length === 0 ? (
          <div className="empty">No routes assigned by admin yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8, padding: 12 }}>
            {routes.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f8fafc', borderRadius: 10 }}>
                <RouteIcon size={15} color="#4f46e5" />
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13 }}>{r.name}</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.start_point} → {r.end_point} · {r.speed_limit} km/h</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>My Assigned Trips</h3>
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Employee</th><th>Vehicle</th><th>Route</th><th>Pickup</th><th>Status</th></tr></thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td><b>{t.employee_name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.emp_id}</div></td>
                  <td>{t.vehicle_name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.driver_name}</div></td>
                  <td>{t.route_name || '—'}</td>
                  <td>{t.pickup_time || t.login_time || '—'}</td>
                  <td><Badge color={statusColor(t.status)}>{statusLabel(t.status)}</Badge></td>
                </tr>
              ))}
              {!trips.length && <tr><td colSpan={6} className="empty">No trips assigned yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {stats?.recentTrips?.length > 0 && (
        <>
          <h3 style={{ margin: '18px 0 10px', fontSize: 15 }}>Today's Live Status</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {stats.recentTrips.map((t) => (
              <div className="card" key={t.id} style={{ borderLeft: `3px solid ${t.status === 'in_progress' ? '#f59e0b' : t.status === 'completed' ? '#22c55e' : '#94a3b8'}` }}>
                <b>{t.employee_name}</b>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{t.vehicle_name} · {t.driver_name}</div>
                <Badge color={statusColor(t.status)}>{statusLabel(t.status)}</Badge>
              </div>
            ))}
          </div>
        </>
      )}

      {modal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="page-title">Edit vehicle</div>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field full"><label>Vehicle name *</label><input value={form.vehicle_name} onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })} /></div>
              <div className="field"><label>Plate</label><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
              <div className="field"><label>Type</label><input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></div>
              <div className="field"><label>Capacity</label><input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
              <div className="field"><label>Stand (optional)</label><input value={form.stand} onChange={(e) => setForm({ ...form, stand: e.target.value })} /></div>
              <div className="field full"><label>Driver (from driver accounts)</label>
                <select value={form.driver_id} onChange={(e) => pickDriver(e.target.value)}>
                  <option value="">— No driver —</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.emp_id}){d.vehicle_id ? ' · on another cab' : ''}</option>
                  ))}
                </select>
              </div>
              {form.driver_id !== '' ? (
                <div className="field full" style={{ fontSize: 13, color: 'var(--muted)' }}>Linked to <b>{form.driver_name}</b> · {form.driver_phone || 'no phone'} — the driver's app will use this cab.</div>
              ) : (
                <>
                  <div className="field"><label>Driver name</label><input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
                  <div className="field"><label>Driver phone</label><input value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} /></div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
