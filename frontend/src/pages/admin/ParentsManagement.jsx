import React, { useEffect, useState } from 'react';
import { api, ensureArray } from '../../api';
import { Modal, Badge, useToast } from '../../components/ui';
import { Plus, Search, KeyRound, Trash2, Pencil, Users, School, Link2, Unlink } from 'lucide-react';

export default function ParentsManagement() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [schools, setSchools] = useState([]);
  const [students, setStudents] = useState([]);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(null);
  const [resetOpen, setResetOpen] = useState(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', password: '', school_id: '', student_ids: [] });
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', status: 'active', school_id: '' });
  const [linkOpen, setLinkOpen] = useState(null);
  const [linkStudent, setLinkStudent] = useState('');

  const load = () => {
    api.get('/api/admin/parents').then((r) => setList(ensureArray(r))).catch(() => setList([]));
  };
  useEffect(() => {
    load();
    api.get('/api/owner/schools').then((r) => setSchools(ensureArray(r))).catch(() =>
      api.get('/api/admin/schools').then((r2) => setSchools(ensureArray(r2))).catch(() => setSchools([]))
    );
    api.get('/api/admin/users', { role: 'student' }).then((r) => setStudents(ensureArray(r))).catch(() => setStudents([]));
  }, []);

  const filtered = list.filter((p) => {
    const s = q.toLowerCase();
    return !s || (p.name || '').toLowerCase().includes(s) || (p.email || '').toLowerCase().includes(s) || (p.phone || '').toLowerCase().includes(s);
  });

  const addParent = async () => {
    if (!addForm.name || !addForm.email || !addForm.password) return toast('Name, email and password are required', 'err');
    try {
      await api.post('/api/admin/parents', {
        name: addForm.name, email: addForm.email, phone: addForm.phone,
        password: addForm.password, schoolId: addForm.school_id || null,
        studentIds: addForm.student_ids, relation: 'guardian'
      });
      toast('Parent account created', 'ok');
      setAddOpen(false);
      setAddForm({ name: '', email: '', phone: '', password: '', school_id: '', student_ids: [] });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/api/admin/parents/${editOpen.id}`, {
        name: editForm.name, email: editForm.email, phone: editForm.phone,
        status: editForm.status, schoolId: editForm.school_id || null
      });
      toast('Parent updated', 'ok');
      setEditOpen(null);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const openEdit = (p) => {
    setEditOpen(p);
    setEditForm({ name: p.name, email: p.email, phone: p.phone || '', status: p.status || 'active', school_id: p.school_id || '' });
  };

  const doReset = async () => {
    if (!pwd) return toast('Enter a new password', 'err');
    if (pwd !== pwd2) return toast('Passwords do not match', 'err');
    if (pwd.length < 6) return toast('Password must be at least 6 characters', 'err');
    try {
      await api.post(`/api/admin/parents/${resetOpen.id}/reset-password`, { password: pwd });
      toast('Password reset', 'ok');
      setResetOpen(null); setPwd(''); setPwd2('');
    } catch (e) { toast(e.message, 'err'); }
  };

  const removeParent = async (p) => {
    if (!confirm(`Delete ${p.name}'s account and their child links? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/parents/${p.id}`);
      toast('Parent deleted', 'ok');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const doLink = async () => {
    if (!linkStudent) return toast('Select a student to link', 'err');
    try {
      await api.post(`/api/admin/parents/${linkOpen.id}/link-student`, { studentId: linkStudent, relation: 'guardian' });
      toast('Student linked', 'ok');
      setLinkOpen(null); setLinkStudent('');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const unlinkStudent = async (p, sid) => {
    if (!confirm(`Unlink student #${sid} from ${p.name}?`)) return;
    try {
      await api.del(`/api/admin/parents/${p.id}/link-student/${sid}`);
      toast('Student unlinked', 'ok');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const active = list.filter((p) => p.status === 'active').length;
  const linked = list.reduce((n, p) => n + (Number(p.children_count) || 0), 0);
  const candidates = (linkOpen ? students : []).filter((st) => !(linkOpen?.children || []).some((c) => Number(c.student_id) === Number(st.id)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Parent Accounts</h1>
          <p className="page-sub">Create, manage and link parent accounts for guardians tracking their children's journeys.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add Parent</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="num">{list.length}</div><div className="lbl">Total Parents</div></div>
        <div className="stat"><div className="num">{active}</div><div className="lbl">Active</div></div>
        <div className="stat"><div className="num">{linked}</div><div className="lbl">Child Links</div></div>
        <div className="stat"><div className="num">{schools.length}</div><div className="lbl">Schools</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ margin: 0 }}>
          <div className="search-wrap">
            <Search size={16} />
            <input className="inp" placeholder="Search name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Parent</th>
                <th>Contact</th>
                <th>School</th>
                <th>Linked Children</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="user-cell">
                      <div className="avatar">{(p.name || 'P').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{p.emp_id}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{p.email}</div>
                    {p.phone && <div className="muted" style={{ fontSize: 12 }}>{p.phone}</div>}
                  </td>
                  <td>
                    {p.school_name ? (
                      <span className="chip"><School size={13} /> {p.school_name}</span>
                    ) : (<span className="muted" style={{ fontSize: 13 }}>Unassigned</span>)}
                  </td>
                  <td>
                    {ensureArray(p.children).length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 260 }}>
                        {ensureArray(p.children).map((c) => (
                          <span key={c.student_id} className="chip">
                            <Users size={12} /> {c.student_name || `#${c.student_id}`} ({c.relation})
                            <button className="chip-x" onClick={() => unlinkStudent(p, c.student_id)} title="Unlink"><Unlink size={11} /></button>
                          </span>
                        ))}
                      </div>
                    ) : (<span className="muted" style={{ fontSize: 13 }}>No children linked</span>)}
                  </td>
                  <td><Badge color={p.status === 'active' ? 'green' : 'slate'}>{p.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-icon" title="Link student" onClick={() => { setLinkOpen(p); setLinkStudent(''); }}><Link2 size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Edit" onClick={() => openEdit(p)}><Pencil size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Reset password" onClick={() => setResetOpen(p)}><KeyRound size={15} /></button>
                      <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => removeParent(p)} style={{ color: 'var(--danger)' }}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={6}><div className="empty">No parents found{q ? ' matching your search' : ''}.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={addOpen} title="Add Parent Account" onClose={() => setAddOpen(false)}>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label className="lbl">Full name *</label><input className="inp" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
            <div className="field"><label className="lbl">Email *</label><input className="inp" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} /></div>
            <div className="field"><label className="lbl">Phone</label><input className="inp" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} /></div>
            <div className="field"><label className="lbl">Temporary password *</label><input className="inp" type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} /></div>
            <div className="field">
              <label className="lbl">School</label>
              <select className="inp" value={addForm.school_id} onChange={(e) => setAddForm({ ...addForm, school_id: e.target.value })}>
                <option value="">Unassigned</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="lbl">Link students (from chosen school)</label>
              <select className="inp" value={addForm.student_ids[0] || ''} onChange={(e) => setAddForm({ ...addForm, student_ids: e.target.value ? [Number(e.target.value)] : [] })}>
                <option value="">None yet (link later)</option>
                {students.filter((st) => !addForm.school_id || String(st.school_id) === String(addForm.school_id)).map((st) => (
                  <option key={st.id} value={st.id}>{st.name} • {st.emp_id || `#${st.id}`}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-btm">
          <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={addParent}><Plus size={16} /> Create Parent</button>
        </div>
      </Modal>

      <Modal open={!!editOpen} title={`Edit Parent — ${editOpen?.name || ''}`} onClose={() => setEditOpen(null)}>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label className="lbl">Full name</label><input className="inp" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div className="field"><label className="lbl">Email</label><input className="inp" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            <div className="field"><label className="lbl">Phone</label><input className="inp" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div className="field">
              <label className="lbl">School</label>
              <select className="inp" value={editForm.school_id} onChange={(e) => setEditForm({ ...editForm, school_id: e.target.value })}>
                <option value="">Unassigned</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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

      <Modal open={!!linkOpen} title={`Link Student — ${linkOpen?.name || ''}`} onClose={() => setLinkOpen(null)}>
        <div className="modal-body">
          <div className="field">
            <label className="lbl">Student to link</label>
            <select className="inp" value={linkStudent} onChange={(e) => setLinkStudent(e.target.value)}>
              <option value="">Select student…</option>
              {candidates.map((st) => (
                <option key={st.id} value={st.id}>{st.name} • {st.emp_id || `#${st.id}`}{st.school_id ? '' : ''}</option>
              ))}
            </select>
          </div>
          {!candidates.length && <div className="empty">All students are already linked to this parent.</div>}
        </div>
        <div className="modal-btm">
          <button className="btn btn-ghost" onClick={() => setLinkOpen(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doLink}><Link2 size={16} /> Link Student</button>
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