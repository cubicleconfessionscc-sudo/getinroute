import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge, Modal } from '../../components/ui';
import { School, ShieldCheck, Users, Bus, ShieldAlert, CheckCircle2, Ban, Trash2, Plus } from 'lucide-react';

export default function SchoolManagement() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', contact_phone: '', support_email: '', adminName: '', adminEmail: '', adminPassword: '' });

  const load = () => {
    setLoading(true);
    api.get('/api/owner/schools').then((r) => setList(Array.isArray(r) ? r : []))
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/owner/schools', form);
      toast('School registered — approve the admin to go live');
      setShowAdd(false);
      setForm({ name: '', contact_phone: '', support_email: '', adminName: '', adminEmail: '', adminPassword: '' });
      load();
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  const approve = async (id) => {
    try { await api.post(`/api/owner/schools/${id}/approve`); toast('School approved'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const toggleStatus = async (id, status) => {
    try { await api.post(`/api/owner/schools/${id}/status`, { status }); toast('Status updated'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (id) => {
    if (!confirm('Delete this school and its admin account? This cannot be undone.')) return;
    try { await api.del(`/api/owner/schools/${id}`); toast('School deleted'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Schools</div>
          <div className="page-sub">Manage GetInRoute School vertical clients</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Register school</button>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>School</th><th>Admin</th><th>Status</th><th>Students</th><th>Parents</th><th>Buses</th><th>SOS</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" className="empty">Loading…</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan="8" className="empty">No schools registered yet.</td></tr>}
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}><School size={16} /> {s.name}</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.contact_phone || '—'} {s.support_email ? `· ${s.support_email}` : ''}</div>
                </td>
                <td>
                  {s.admin ? (
                    <div>
                      <div style={{ fontSize: 13 }}>{s.admin.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.admin.email}</div>
                    </div>
                  ) : <div style={{ color: 'var(--muted)', fontSize: 13 }}>—</div>}
                </td>
                <td>
                  <Badge color={s.status === 'active' ? 'green' : 'slate'}>{s.status}</Badge>{' '}
                  {s.admin && !s.admin.approved && <Badge color="amber">Pending approval</Badge>}
                </td>
                <td>{s.students}</td>
                <td>{s.parents}</td>
                <td>{s.vehicles}</td>
                <td>{s.open_sos > 0 ? <Badge color="red"><ShieldAlert size={12} /> {s.open_sos}</Badge> : 0}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {s.admin && !s.admin.approved && (
                      <button className="btn btn-sm btn-primary" onClick={() => approve(s.id)} disabled={s.status === 'inactive'}><CheckCircle2 size={13} /> Approve</button>
                    )}
                    {s.status === 'active'
                      ? <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(s.id, 'inactive')}><Ban size={13} /> Deactivate</button>
                      : <button className="btn btn-sm btn-outline" onClick={() => toggleStatus(s.id, 'active')}><ShieldCheck size={13} /> Activate</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(s.id)}><Trash2 size={13} color="#ef4444" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Register a school">
        <form onSubmit={create}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>School name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="St. Mary's Public School" />
          </div>
          <div className="form-grid">
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Contact phone</label>
              <input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="+91…" />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Support email</label>
              <input type="email" value={form.support_email} onChange={(e) => setForm({ ...form, support_email: e.target.value })} placeholder="school@example.com" />
            </div>
          </div>
          <div style={{ fontWeight: 700, margin: '4px 0 10px', fontSize: 13 }}>School admin account</div>
          <div className="form-grid">
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Admin name *</label>
              <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Admin email *</label>
              <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Admin password * (min 6)</label>
            <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required minLength="6" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Register school'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}