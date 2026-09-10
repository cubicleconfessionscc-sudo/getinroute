import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import { Plus, Pencil, Trash2, Truck } from 'lucide-react';

const empty = { vehicle_name: '', plate: '', type: 'bus', capacity: 40, stand: '', line: 1, trip: 1, route_id: '', driver_id: '' };

export default function SchoolVehicles() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = () => {
    api.get('/api/school/vehicles').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/school/routes').then((r) => setRoutes(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/school/drivers').then((r) => setDrivers(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const openEdit = (v) => {
    if (v) {
      setEditing(v.id);
      setForm({ vehicle_name: v.vehicle_name, plate: v.plate || '', type: v.type || 'bus', capacity: v.capacity, stand: v.stand || '', line: v.line, trip: v.trip, route_id: v.route_id ? String(v.route_id) : '', driver_id: v.driver_id ? String(v.driver_id) : '' });
    } else { setEditing(null); setForm(empty); }
    setModal(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, route_id: form.route_id ? Number(form.route_id) : null, driver_id: form.driver_id ? Number(form.driver_id) : null };
      if (editing) await api.put(`/api/school/vehicles/${editing}`, payload);
      else await api.post('/api/school/vehicles', payload);
      toast(editing ? 'Vehicle updated' : 'Vehicle added');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (v) => {
    if (!confirm(`Remove vehicle ${v.vehicle_name}?`)) return;
    try { await api.del(`/api/school/vehicles/${v.id}`); toast('Vehicle removed'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const currentDriver = (v) => v.driver_name || drivers.find((d) => d.id === v.driver_id)?.name || null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Vehicles</div>
          <div className="page-sub">School buses and their assigned route + driver.</div>
        </div>
        <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add vehicle</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Bus</th><th>Route</th><th>Driver</th><th>Capacity</th><th>Today</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.vehicle_name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.plate || v.type}</div></td>
                  <td style={{ fontSize: 13 }}>{v.route_name || '—'}</td>
                  <td>
                    {currentDriver(v)
                      ? <div style={{ fontSize: 13 }}>{currentDriver(v)}{v.driver_verified ? ' ✔' : ''}</div>
                      : <Badge color="slate">No driver</Badge>}
                  </td>
                  <td style={{ fontSize: 13 }}>{v.capacity ?? '—'}</td>
                  <td>{v.assigned_today ? <Badge color="blue">{v.assigned_today} trips</Badge> : <Badge color="slate">Idle</Badge>}</td>
                  <td>{v.status === 'active' ? <Badge color="green">On trip</Badge> : <Badge color="slate">Idle</Badge>}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(v)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(v)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7}><div className="empty">No vehicles yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit vehicle' : 'Add vehicle'}>
        <div className="form-grid">
          <div className="field"><label>Bus name *</label><input value={form.vehicle_name} onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })} placeholder="Bus 1" /></div>
          <div className="field"><label>Plate</label><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
          <div className="field"><label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="bus">Bus</option><option value="van">Van</option><option value="car">Car</option>
            </select>
          </div>
          <div className="field"><label>Capacity</label><input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          <div className="field"><label>Route</label>
            <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
              <option value="">— No route —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Driver</label>
            <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">— No driver —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} {d.driver_verified ? '✔' : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Line / Trip</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} />
              <input type="number" value={form.trip} onChange={(e) => setForm({ ...form, trip: e.target.value })} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Truck size={16} /> Save vehicle</button>
        </div>
      </Modal>
    </div>
  );
}