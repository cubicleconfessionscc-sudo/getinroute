import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import MapPicker from '../../components/MapPicker';
import { Plus, Pencil, Trash2, Home } from 'lucide-react';

const empty = { label: '', address: '', type: 'zone', radius_meters: 300, lat: '', lng: '' };

export default function SchoolNodalPoints() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [pick, setPick] = useState(false);

  const load = () => api.get('/api/school/nodal-points').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const openEdit = (z) => {
    if (z) { setEditing(z.id); setForm({ label: z.label, address: z.address || '', type: z.type || 'zone', radius_meters: z.radius_meters ?? 300, lat: z.lat ?? '', lng: z.lng ?? '' }); }
    else { setEditing(null); setForm(empty); }
    setModal(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, lat: Number(form.lat), lng: Number(form.lng), radius_meters: Number(form.radius_meters) || 300 };
      if (editing) await api.put(`/api/school/nodal-points/${editing}`, payload);
      else await api.post('/api/school/nodal-points', payload);
      toast(editing ? 'Zone updated' : 'Zone added');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (z) => {
    if (!confirm(`Remove zone "${z.label}"?`)) return;
    try { await api.del(`/api/school/nodal-points/${z.id}`); toast('Zone removed'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Safety Zones</div>
          <div className="page-sub">Named geofences (school campus, bus stops, drop zones). Buses entering or leaving these are logged.</div>
        </div>
        <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add zone</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Zone</th><th>Type</th><th>Location</th><th>Radius</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((z) => (
                <tr key={z.id}>
                  <td><b>{z.label}</b>{z.address && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{z.address}</div>}</td>
                  <td><Badge color={z.type === 'campus' ? 'blue' : 'pink'}>{z.type}</Badge></td>
                  <td style={{ fontSize: 12 }}>{z.lat?.toFixed?.(4) ?? z.lat}, {z.lng?.toFixed?.(4) ?? z.lng}</td>
                  <td style={{ fontSize: 13 }}>{z.radius_meters} m</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(z)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(z)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5}><div className="empty">No zones yet. Add your campus so geofence alerts work.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit zone' : 'Add zone'}>
        <div className="form-grid">
          <div className="field"><label>Label *</label><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="School campus" /></div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="zone">Bus stop</option><option value="campus">Campus</option><option value="checkpoint">Checkpoint</option>
            </select>
          </div>
          <div className="field"><label>Radius (metres)</label><input type="number" value={form.radius_meters} onChange={(e) => setForm({ ...form, radius_meters: e.target.value })} /></div>
          <div className="field"><label>Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        </div>
        <button className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={() => setPick(true)}>Pick location on map</button>
        {form.lat !== '' && form.lng !== '' && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Lat {Number(form.lat).toFixed(5)}, Lng {Number(form.lng).toFixed(5)}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Home size={16} /> Save zone</button>
        </div>
      </Modal>

      <Modal open={pick} onClose={() => setPick(false)} title="Tap the map to set the zone centre">
        <MapPicker
          lat={form.lat === '' ? null : Number(form.lat)}
          lng={form.lng === '' ? null : Number(form.lng)}
          onPick={(la, ln) => { setForm((f) => ({ ...f, lat: la, lng: ln })); setPick(false); }}
          height="320px"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => setPick(false)}>Close</button>
        </div>
      </Modal>
    </div>
  );
}