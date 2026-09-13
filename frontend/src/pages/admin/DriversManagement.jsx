import React, { useEffect, useState } from 'react';
import { api, ensureArray } from '../../api';
import { Modal, Badge, useToast } from '../../components/ui';
import { Plus, Search, KeyRound, Power, Trash2, Pencil, Truck, Users, CheckCircle2, XCircle } from 'lucide-react';

const VEHCACHE = {};

export default function DriversManagement() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(null);
  const [resetOpen, setResetOpen] = useState(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', emp_id: '', password: '', vehicle_id: '' });
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', status: 'active', vehicle_id: '' });

  const load = () => {
    api.get('/api/admin/drivers/all').then((r) => {
      const arr = ensureArray(r);
      setList(arr.map((d) => {
        if (d.vehicle_id && !VEHCACHE[d.vehicle_id]) VEHCACHE[d.vehicle_id] = d.vehicle_name || d.plate || null;
        return d;
      }));
    }).catch(() => setList([]));
  };
  useEffect(() => {
    load();
    api.get('/api/admin/vehicles').then((r) => setVehicles(ensureArray(r))).catch(() => {});
  }, []);

  const filtered = list.filter((d) => {
    const s = q.toLowerCase();
    return !s || (d.name || '').toLowerCase().includes(s) || (d.email || '').toLowerCase().includes(s) || (d.emp_id || '').toLowerCase().includes(s);
  });

  const addDriver = async () => {
    if (!addForm.name || !addForm.email || !addForm.password) return toast('Name, email and password are required', 'err');
    try {
      await api.post('/api/admin/drivers', {
        ...addForm,
        vehicle_id: addForm.vehicle_id || null
      });
      toast('Driver account created', 'ok');
      setAddOpen(false);
      setAddForm({ name: '', email: '', phone: '', emp_id: '', password: '', vehicle_id: '' });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/api/admin/drivers/${editOpen.id}`, {
        name: editForm.name, email: editForm.email, phone: editForm.phone,
        status: editForm.status, vehicle_id: editForm.vehicle_id || null
      });
      toast('Driver updated', 'ok');
      setEditOpen(null);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const openEdit = (d) => {
    setEditOpen(d);
    setEditForm({ name: d.name, email: d.email, phone: d.phone || '', status: d.status || 'active', vehicle_id: d.vehicle_id || '' });
  };

  const doReset = async () => {
    if (!pwd) return toast('Enter a new password', 'err');
    if (pwd !== pwd2) return toast('Passwords do not match', 'err');
    if (pwd.length < 6) return toast('Password must be at least 6 characters', 'err');
    try {
      await api.post(`/api/admin/drivers/${resetOpen.id}/reset-password`, { password: pwd });
      toast('Password reset', 'ok');
      setResetOpen(null);
      setPwd(''); setPwd2('');
    } catch (e) { toast(e.message, 'err'); }
  };

  const setStatus = async (d) => {
    const next = d.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/api/admin/drivers/${d.id}`, { status: next });
      toast(`${d.name} ${next === 'active' ? 'activated' : 'deactivated'}`, next === 'active' ? 'ok' : 'info');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const removeDriver = async (d) => {
    if (!confirm(`Delete ${d.name}'s account? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/drivers/${d.id}`);
      toast('Driver deleted', 'ok');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const active = list.filter((d) => d.status === 'active').length;
  const assigned = vehicles.filter((v) => v.driver_id && Number(v.driver_id) !== 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Driver Accounts</h1>
          <p className="page-sub">Create, edit, assign and control driver access. Drivers sign in with their email and password.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add Driver</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="num">{list.length}</div><div className="lbl">Total Drivers</div></div>
        <div className="stat"><div className="num">{active}</div><div className="lbl">Active</div></div>
        <div className="stat"><div className="num">{list.length - active}</div><div className="lbl">Inactive</div></div>
        <div className="stat"><div className="num">{assigned}</div><div className="lbl">Vehicle-Assigned</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ margin: 0 }}>
          <div className="search-wrap">
            <Search size={16} />
            <input className="inp" placeholder="Search name, email or driver ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Driver ID</th>
                <th>Contact</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="user-cell">
                      <div className="avatar">{((d.name || 'D').split(' ').map((w) => w[0]).slice(0, 2).join('')).toUpperCase()}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                        {d.emp_id && <div className="muted" style={{ fontSize: 12 }}>{d.emp_id}</div>}
                      </div>
                    </div>
                  </td>
                  <td><code className="emp-ido">{d.emp_id || '—'}</code></td>
                  <td>
                    <div style={{ fontSize: 13 }}>{d.email}</div>
                    {d.phone && <div className="muted" style={{ fontSize: 12 }}>{d.phone}</div>}
                  </td>
                  <td>
                    {d.vehicle_name || VEHCACHE[d.vehicle_id] ? (
                      <span className="chip"><Truck size={13} /> {d.vehicle_name || VEHCACHE[d.vehicle_id]} {d.plate ? `• ${d.plate}` : ''}</span>
                    ) : (<span className="muted" style={{ fontSize: 13 }}>Unassigned</span>)}
                  </td>
                  <td>
                    <Badge color={d.status === 'active' ? 'green' : 'slate'}>{d.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-icon" title="Edit" onClick={() => openEdit(d)}><Pencil size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Reset password" onClick={() => setResetOpen(d)}><KeyRound size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title={d.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => setStatus(d)}>
                        {d.status === 'active' ? <XCircle size={15} /> : <Power size={15} />}
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => removeDriver(d)} style={{ color: 'var(--danger)' }}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={6}><div className="empty">No drivers found{q ? ' matching your search' : ''}.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={addOpen} title="Add Driver Account" onClose={() => setAddOpen(false)}>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label className="lbl">Full name *</label><input className="inp" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
            <div className="field"><label className="lbl">Email / username *</label><input className="inp" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} /></div>
            <div className="field"><label className="lbl">Phone</label><input className="inp" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} /></div>
            <div className="field"><label className="lbl">Driver / License ID</label><input className="inp" value={addForm.emp_id} onChange={(e) => setAddForm({ ...addForm, emp_id: e.target.value })} /></div>
            <div className="field"><label className="lbl">Temporary password *</label><input className="inp" type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} /></div>
            <div className="field">
              <label className="lbl">Assign vehicle</label>
              <select className="inp" value={addForm.vehicle_id} onChange={(e) => setAddForm({ ...addForm, vehicle_id: e.target.value })}>
                <option value="">Unassigned</option>
                {vehicles.filter((v) => !v.driver_id || Number(v.driver_id) === 0).map((v) => (
                  <option key={v.id} value={v.id}>{v.vehicle_name} {v.plate ? `• ${v.plate}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-btm">
          <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={addDriver}><Plus size={16} /> Create Driver</button>
        </div>
      </Modal>

      <Modal open={!!editOpen} title={`Edit Driver — ${editOpen?.name || ''}`} onClose={() => setEditOpen(null)}>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label className="lbl">Full name</label><input className="inp" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div className="field"><label className="lbl">Email</label><input className="inp" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            <div className="field"><label className="lbl">Phone</label><input className="inp" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div className="field">
              <label className="lbl">Assign vehicle</label>
              <select className="inp" value={editForm.vehicle_id} onChange={(e) => setEditForm({ ...editForm, vehicle_id: e.target.value })}>
                <option value="">Unassigned</option>
                {vehicles.filter((v) => !v.driver_id || Number(v.driver_id) === 0 || Number(v.driver_id) === Number(editOpen?.id)).map((v) => (
                  <option key={v.id} value={v.id}>{v.vehicle_name} {v.plate ? `• ${v.plate}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="lbl">Status</label>
              <select className="inp" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-btm">
          <button className="btn btn-ghost" onClick={() => setEditOpen(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveEdit}>Save Changes</button>
        </div>
      </Modal>

      <Modal open={!!resetOpen} title={`Reset password — ${resetOpen?.name || ''}`} onClose={() => { setResetOpen(null); setPwd(''); setPwd2(''); }}>
        <div className="modal-body">
          <div className="field"><label className="lbl">New password</label><input className="inp" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
          <div className="field"><label className="lbl">Confirm new password</label><input className="inp" type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} /></div>
        </div>
        <div className="modal-btm">
          <button className="btn btn-ghost" onClick={() => { setResetOpen(null); setPwd(''); setPwd2(''); }}>Cancel</button>
          <button className="btn btn-primary" onClick={doReset}><KeyRound size={16} /> Reset Password</button>
        </div>
      </Modal>
    </div>
  );
}