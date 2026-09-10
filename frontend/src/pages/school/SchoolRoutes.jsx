import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import MapPicker from '../../components/MapPicker';
import { Plus, Pencil, Trash2, Route as RouteIcon, MapPin, X } from 'lucide-react';

const empty = { name: '', speed_limit: 40, sequence_control: 'admin', status: 'active', stops: [{ name: '', lat: '', lng: '' }, { name: '', lat: '', lng: '' }] };

export default function SchoolRoutes() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [mapStop, setMapStop] = useState(null);

  const load = () => api.get('/api/school/routes').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const openEdit = (r) => {
    if (r) {
      setEditing(r.id);
      setForm({ name: r.name, speed_limit: r.speed_limit ?? 40, sequence_control: r.sequence_control || 'admin', status: r.status || 'active', stops: (r.stops?.length ? r.stops : []).map((s) => ({ name: s.name || '', lat: s.lat ?? '', lng: s.lng ?? '' })) });
    } else { setEditing(null); setForm(empty); }
    setModal(true);
  };

  const setStop = (i, patch) => setForm((f) => ({ ...f, stops: f.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const addStop = () => setForm((f) => ({ ...f, stops: [...f.stops, { name: '', lat: '', lng: '' }] }));
  const removeStop = (i) => setForm((f) => ({ ...f, stops: f.stops.filter((_, idx) => idx !== i) }));
  const firstPoint = () => form.stops.find((s) => s.lat !== '' && s.lng !== '');

  const save = async () => {
    try {
      const stops = form.stops.map((s, i) => ({ sequence: i + 1, name: s.name || `Stop ${i + 1}`, lat: s.lat === '' ? null : Number(s.lat), lng: s.lng === '' ? null : Number(s.lng) }));
      const filled = stops.filter((s) => s.lat != null && s.lng != null);
      if (filled.length < 2) throw new Error('Add at least 2 stops with map locations');
      const payload = {
        name: form.name, speed_limit: Number(form.speed_limit) || 40, sequence_control: form.sequence_control,
        status: editing ? form.status : 'active', stops
      };
      if (editing) await api.put(`/api/school/routes/${editing}`, payload);
      else await api.post('/api/school/routes', payload);
      toast(editing ? 'Route updated' : 'Route created');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (r) => {
    if (!confirm(`Delete route "${r.name}"?`)) return;
    try { await api.del(`/api/school/routes/${r.id}`); toast('Route deleted'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Routes & Stops</div>
          <div className="page-sub">Bus routes, pickup stop order, and who controls the sequence — admin or driver.</div>
        </div>
        <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add route</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Route</th><th>Stops</th><th>Speed limit</th><th>Sequence control</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.start_point} → {r.end_point}</div></td>
                  <td style={{ fontSize: 13 }}>{Array.isArray(r.stops) ? r.stops.length : 0} stops</td>
                  <td style={{ fontSize: 13 }}>{r.speed_limit} km/h</td>
                  <td>{r.sequence_control === 'driver' ? <Badge color="pink">Driver controls</Badge> : <Badge color="blue">Admin controls</Badge>}</td>
                  <td>{r.status === 'active' ? <Badge color="green">Active</Badge> : <Badge color="slate">Inactive</Badge>}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(r)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(r)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6}><div className="empty">No routes yet. Create one to start assigning buses.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit route' : 'Add route'} wide>
        <div className="form-grid">
          <div className="field full"><label>Route name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. MG Road → Railway Station" /></div>
          <div className="field"><label>Speed limit (km/h)</label><input type="number" value={form.speed_limit} onChange={(e) => setForm({ ...form, speed_limit: e.target.value })} /></div>
          <div className="field">
            <label>Sequence control</label>
            <select value={form.sequence_control} onChange={(e) => setForm({ ...form, sequence_control: e.target.value })}>
              <option value="admin">Admin sets the order</option>
              <option value="driver">Driver advances the order</option>
            </select>
          </div>
          {editing && (
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="m-label">Stops (in pickup order)</div>
          {form.stops.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <input style={{ flex: 1, minWidth: 120 }} value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} placeholder="Stop name" />
              <input style={{ width: 110 }} type="number" step="any" placeholder="Lat" value={s.lat} onChange={(e) => setStop(i, { lat: e.target.value })} />
              <input style={{ width: 110 }} type="number" step="any" placeholder="Lng" value={s.lng} onChange={(e) => setStop(i, { lng: e.target.value })} />
              <button type="button" className="btn btn-sm btn-outline" title="Pick on map" onClick={() => setMapStop(i)}><MapPin size={14} /></button>
              {form.stops.length > 2 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeStop(i)}><X size={14} color="#ef4444" /></button>
              )}
            </div>
          ))}
          <button className="btn btn-sm btn-outline" onClick={addStop} style={{ marginTop: 6 }}><Plus size={14} /> Add stop</button>
        </div>

        {firstPoint()?.lat !== '' && firstPoint()?.lng !== '' && (
          <div style={{ marginTop: 14 }}>
            <MapPicker lat={Number(firstPoint().lat) || null} lng={Number(firstPoint().lng) || null} onPick={(la, ln) => { /* hint only */ }} height="180px" label="Route preview on the first stop." />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><RouteIcon size={16} /> Save route</button>
        </div>
      </Modal>

      <Modal open={mapStop != null} onClose={() => setMapStop(null)} title={`Stop ${mapStop != null ? mapStop + 1 : ''} — tap the map to set`}>
        {mapStop != null && (
          <MapPicker
            lat={form.stops[mapStop]?.lat === '' ? null : Number(form.stops[mapStop]?.lat)}
            lng={form.stops[mapStop]?.lng === '' ? null : Number(form.stops[mapStop]?.lng)}
            onPick={(la, ln) => { setStop(mapStop, { lat: la, lng: ln }); setMapStop(null); }}
            height="320px"
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => setMapStop(null)}>Close</button>
        </div>
      </Modal>
    </div>
  );
}