import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Modal, Badge, useToast } from '../../components/ui';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react';

const empty = { vehicle_name: '', plate: '', type: 'Cab', capacity: 4, stand: '', line: 1, trip: 1, route_id: '', driver_name: '', driver_phone: '', driver_id: '', vendor_id: '', speed_limit: 40 };

export default function VehiclesPage() {
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [spdBox, setSpdBox] = useState({});

  const load = () => {
    api.get('/api/admin/vehicles').then((r) => setVehicles(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/admin/routes').then((r) => setRoutes(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/admin/vendors').then((r) => setVendors(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/admin/drivers').then((r) => setDrivers(Array.isArray(r) ? r.filter((d) => d.approved === 1) : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const pickDriver = (id) => {
    const d = drivers.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, driver_id: id, driver_name: d ? d.name : f.driver_name, driver_phone: d ? (d.phone || '') : f.driver_phone }));
  };

  const openEdit = (v) => {
    setEditing(v ? v.id : null);
    const linked = drivers.find((x) => x.phone && v?.driver_phone && x.phone === v.driver_phone);
    setForm({
      vehicle_name: v?.vehicle_name || '', plate: v?.plate || '', type: v?.type || 'Cab', capacity: v?.capacity || 4,
      stand: v?.stand || '', line: v?.line || 1, trip: v?.trip || 1, route_id: v?.route_id || '', vendor_id: v?.vendor_id || '',
      driver_name: v?.driver_name || '', driver_phone: v?.driver_phone || '', driver_id: linked ? String(linked.id) : '',
      speed_limit: v?.speed_limit || 40
    });
    setModal(true);
  };

  const save = async () => {
    const payload = { ...form, route_id: form.route_id ? Number(form.route_id) : null, vendor_id: form.vendor_id ? Number(form.vendor_id) : null, capacity: Number(form.capacity) || 4, speed_limit: Number(form.speed_limit) || 40 };
    try {
      if (editing) await api.put(`/api/admin/vehicles/${editing}`, payload);
      else await api.post(`/api/admin/vehicles`, payload);
      toast(editing ? 'Vehicle updated' : 'Vehicle added');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const delVehicle = async (v) => {
    if (!confirm(`Remove ${v.vehicle_name} (${v.plate || 'no plate'})? This cannot be undone.`)) return;
    await api.del(`/api/admin/vehicles/${v.id}`);
    toast('Vehicle removed');
    load();
  };

  const setPos = async (v, line, trip) => {
    await api.put(`/api/admin/vehicles/${v.id}/position`, { line, trip });
    toast(`${v.vehicle_name} → Line ${line}, Trip ${trip}`);
    load();
  };
  const setSpeedLimit = async (v) => {
    const val = Number(spdBox[v.id]);
    if (!val || val <= 0) return toast('Enter a valid speed limit', 'err');
    await api.put(`/api/admin/vehicles/${v.id}/speed-limit`, { speed_limit: val });
    toast(`${v.vehicle_name} speed limit → ${val} km/h`);
    load();
  };

  const setRoute = async (v, routeId) => {
    await api.put(`/api/admin/vehicles/${v.id}/route`, { route_id: routeId ? Number(routeId) : null });
    toast(`${v.vehicle_name} route updated`);
    load();
  };

  const lineOptions = Array.from({ length: 10 }, (_, i) => i + 1);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Vehicles & Drivers</div>
          <div className="page-sub">Allocate vehicles to lines 1–10 and trips 1–2, and manage driver & cab details.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isVendor && (
            <span className={`chip ${vehicles.length >= 90 ? 'chip-amber' : ''}`}>
              {vehicles.length} / 100 vendor vehicles{vehicles.length >= 90 ? ' · near cap' : ''}
            </span>
          )}
          <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add vehicle</button>
        </div>
      </div>

      {drivers.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0ea5e9', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            Driver Fleet — live ({drivers.length})
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {drivers.map((d) => {
              const v = vehicles.find((x) => String(x.id) === String(d.vehicle_id));
              const onTrip = v && (v.status === 'active');
              const live = v && v.live_status && v.live_status !== 'idle';
              return (
                <div className="card" key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="avatar" style={{ background: onTrip ? 'rgba(74,222,128,.15)' : 'rgba(100,116,139,.15)', color: onTrip ? '#4ade80' : '#94a3b8' }}>
                    {(d.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 14 }}>{d.name}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{d.emp_id} · {d.phone || 'no phone'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{v ? `${v.vehicle_name} (${v.plate})` : 'no cab assigned'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Last login: {d.last_login || 'never'}</div>
                  </div>
                  {onTrip ? <Badge color="green">On trip</Badge> : live ? <Badge color="blue">Live</Badge> : <Badge color="slate">Idle</Badge>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
                <tr>
                  <th>Vehicle</th><th>Type</th><th>Stand</th>{!isVendor && <th>Vendor</th>}<th>Driver</th><th>Phone</th><th>Line</th><th>Trip</th><th>Route</th><th>Speed limit</th><th>Status</th><th>Actions</th>
                </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.vehicle_name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.plate}</div></td>
                  <td><Badge color="blue">{v.type}</Badge> <span style={{ fontSize: 12, color: 'var(--muted)' }}>{v.capacity} seats</span></td>
                  <td style={{ fontSize: 13 }}>{v.stand || '—'}</td>
                  {!isVendor && <td style={{ fontSize: 13 }}>{vendors.find((x) => x.id === v.vendor_id)?.name || '—'}</td>}
                  <td style={{ fontWeight: 600 }}>{v.driver_name || '—'}</td>
                  <td style={{ fontSize: 13, color: 'var(--slate)' }}>{v.driver_phone || '—'}</td>
                  <td>
                    <select value={v.line} onChange={(e) => setPos(v, Number(e.target.value), v.trip)} style={{ padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8 }}>
                      {lineOptions.map((l) => <option key={l} value={l}>Line {l}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={v.trip} onChange={(e) => setPos(v, v.line, Number(e.target.value))} style={{ padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8 }}>
                      <option value={1}>1st trip</option><option value={2}>2nd trip</option>
                    </select>
                  </td>
                  <td>
                    <select value={v.route_id || ''} onChange={(e) => setRoute(v, e.target.value)} style={{ padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8, maxWidth: 170 }}>
                      <option value="">— No route —</option>
                      {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="number" style={{ width: 60, padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8 }} value={spdBox[v.id] ?? (v.speed_limit || 40)} onChange={(e) => setSpdBox({ ...spdBox, [v.id]: e.target.value })} />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>km/h</span>
                      <button className="btn btn-sm btn-outline" onClick={() => setSpeedLimit(v)}>Set</button>
                    </div>
                  </td>
                  <td>
                    {v.status === 'active' ? <Badge color="green">On trip</Badge>
                      : v.assigned_today > 0 ? <Badge color="blue">{v.assigned_today} trips</Badge>
                      : <Badge color="slate">Idle</Badge>}
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(v)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" title="Remove vehicle" onClick={() => delVehicle(v)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit vehicle / driver' : 'Add vehicle'}>
        <div className="form-grid">
          <div className="field"><label>Vehicle name</label><input value={form.vehicle_name} onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })} placeholder="Volvo AC Bus" /></div>
          <div className="field"><label>Number plate</label><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
          <div className="field"><label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>Cab</option><option>Van</option><option>Bus</option><option>Mini</option>
            </select>
          </div>
          <div className="field"><label>Capacity</label><input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          <div className="field"><label>Stand (optional)</label><input value={form.stand} onChange={(e) => setForm({ ...form, stand: e.target.value })} placeholder="e.g. Depot-2 Stand" /></div>
          {!isVendor && <div className="field"><label>Vendor</label>
            <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
              <option value="">— Company owned —</option>
              {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>}
          <div className="field"><label>Line (1–10)</label>
            <select value={form.line} onChange={(e) => setForm({ ...form, line: Number(e.target.value) })}>{lineOptions.map((l) => <option key={l}>{l}</option>)}</select>
          </div>
          <div className="field"><label>Trip</label>
            <select value={form.trip} onChange={(e) => setForm({ ...form, trip: Number(e.target.value) })}><option value={1}>1st trip</option><option value={2}>2nd trip</option></select>
          </div>
          <div className="field"><label>Route</label>
            <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
              <option value="">— No route —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Speed limit (km/h)</label><input type="number" min={1} value={form.speed_limit} onChange={(e) => setForm({ ...form, speed_limit: e.target.value })} /></div>
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
              <div className="field"><label>Driver name</label><input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} placeholder="Ramesh Kumar" /></div>
              <div className="field"><label>Driver phone</label><input value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} placeholder="+91 …" /></div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><MapPin size={16} /> Save</button>
        </div>
      </Modal>
    </div>
  );
}
