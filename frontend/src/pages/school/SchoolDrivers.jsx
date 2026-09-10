import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import { Plus, Trash2, Check, X, Bus, KeyRound } from 'lucide-react';

const empty = { name: '', email: '', phone: '', password: '' };

export default function SchoolDrivers() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [showPw, setShowPw] = useState({});

  const load = () => api.get('/api/school/drivers').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await api.post('/api/school/drivers', form);
      toast('Driver added — they can log in with these credentials');
      setModal(false); setForm(empty); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const setVerified = async (d, verified) => {
    try {
      await api.put(`/api/school/drivers/${d.id}/verify`, { verified });
      toast(`Driver ${verified ? 'verified' : 'unverified'}`);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (d) => {
    if (!confirm(`Remove driver ${d.name}?`)) return;
    try { await api.del(`/api/school/drivers/${d.id}`); toast('Driver removed'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">School Drivers</div>
          <div className="page-sub">Verify drivers so parents see the "verified driver" badge in the app.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> Add driver</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Driver</th><th>Login</th><th>Assigned vehicle</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.phone || ''}</div></td>
                  <td>
                    <span style={{ fontSize: 13 }}>{d.email}</span>
                    {' '}<button className="btn btn-ghost btn-icon" style={{ padding: 3 }} title="Show password"
                      onClick={() => setShowPw((s) => ({ ...s, [d.id]: !s[d.id] }))}>
                      <KeyRound size={13} />
                    </button>
                    {showPw[d.id] && <code style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{d.emp_id}</code>}
                  </td>
                  <td>
                    {d.vehicle_name ? <span style={{ fontSize: 13 }}><Bus size={13} /> {d.vehicle_name} {d.plate ? `· ${d.plate}` : ''}</span> : <Badge color="slate">No vehicle</Badge>}
                  </td>
                  <td>
                    {d.driver_verified ? <Badge color="green">✔ Verified</Badge> : <Badge color="amber">Not verified</Badge>}
                  </td>
                  <td>
                    <div className="actions">
                      <button className={`btn btn-sm ${d.driver_verified ? 'btn-ghost' : 'btn-green'}`} onClick={() => setVerified(d, !d.driver_verified)}>
                        {d.driver_verified ? <X size={14} /> : <Check size={14} />} {d.driver_verified ? 'Unverify' : 'Verify'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(d)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={5}><div className="empty">No drivers yet. Add one to assign to a bus.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setForm(empty); }} title="Add school driver">
        <p style={{ fontSize: 13, color: 'var(--slate)', marginBottom: 12 }}>The driver logs in on the driver app with this email and password.</p>
        <div className="form-grid">
          <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Email *</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Password * (min 6)</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => { setModal(false); setForm(empty); }}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Bus size={16} /> Add driver</button>
        </div>
      </Modal>
    </div>
  );
}