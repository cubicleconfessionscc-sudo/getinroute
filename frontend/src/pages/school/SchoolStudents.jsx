import React, { useEffect, useState } from 'react';
import { api, todayStr } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import { Plus, Pencil, Trash2, KeyRound, Users, Upload, Copy, Check } from 'lucide-react';

const empty = {
  name: '', email: '', phone: '', class_grade: '', section: '', education_level: 'school',
  can_login: false, guardian_name_1: '', guardian_phone_1: '', guardian_name_2: '', guardian_phone_2: '',
  emergency_name: '', emergency_phone: '', notes: '', password: ''
};

export default function SchoolStudents() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [pwModal, setPwModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [csv, setCsv] = useState('');
  const [copied, setCopied] = useState(null);
  const [pw, setPw] = useState('');

  const load = () => api.get('/api/school/students').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const openEdit = (s) => {
    if (s) {
      setEditing(s.id);
      setForm({
        name: s.name, email: s.email || '', phone: s.phone || '', class_grade: s.class_grade || '', section: s.section || '',
        education_level: s.education_level || 'school', can_login: !!s.can_login,
        guardian_name_1: s.guardian_name_1 || '', guardian_phone_1: s.guardian_phone_1 || '',
        guardian_name_2: s.guardian_name_2 || '', guardian_phone_2: s.guardian_phone_2 || '',
        emergency_name: s.emergency_name || '', emergency_phone: s.emergency_phone || '', notes: s.notes || '', password: ''
      });
    } else {
      setEditing(null);
      setForm(empty);
    }
    setModal(true);
  };

  const save = async () => {
    try {
      const payload = { ...form };
      if (payload.education_level !== 'college') { payload.can_login = false; payload.password = ''; }
      if (editing) await api.put(`/api/school/students/${editing}`, payload);
      else await api.post('/api/school/students', payload);
      toast(editing ? 'Student updated' : 'Student added');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (s) => {
    if (!confirm(`Remove ${s.name}? This also deletes their profile.`)) return;
    try { await api.del(`/api/school/students/${s.id}`); toast('Student removed'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const importStudents = async () => {
    const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!rows.length) { toast('Paste at least one row', 'err'); return; }
    const headers = rows[0].toLowerCase().includes('name') ? rows.shift().split(',').map((h) => h.trim()) : null;
    const students = rows.map((line) => {
      const c = line.split(',').map((v) => v.trim());
      const get = (i) => (c[i] !== undefined ? c[i] : '');
      if (headers) {
        const o = {};
        headers.forEach((h, i) => { o[h] = c[i] !== undefined ? c[i] : ''; });
        return o;
      }
      return { name: get(0), email: get(1) || null, phone: get(2) || null, class_grade: get(3) || null, section: get(4) || null };
    }).filter((s) => s.name);
    try {
      const r = await api.post('/api/school/students/import', students);
      toast(`Imported ${r.imported || 0} students`);
      setImportModal(false); setCsv(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const setPassword = async () => {
    try {
      if (pw.length < 6) throw new Error('Password must be at least 6 characters');
      await api.post(`/api/school/students/${pwModal.id}/password`, { password: pw });
      toast(`Login password set for ${pwModal.name}`);
      setPwModal(null); setPw(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const copy = (code) => {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const grade = (s) => [s.class_grade, s.section].filter(Boolean).join(' − ') || '—';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Students</div>
          <div className="page-sub">Roster, guardians and parent link codes. Share each child's code so parents can join.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setImportModal(true)}><Upload size={16} /> Import</button>
          <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Add student</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Class / Section</th><th>Level</th><th>Guardian 1</th><th>Parent link code</th><th>Today</th><th>Parents</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.email || s.emp_id}</div>
                  </td>
                  <td>{grade(s)}</td>
                  <td>
                    {s.education_level === 'college'
                      ? <Badge color="violet">College{s.can_login ? ' · login' : ''}</Badge>
                      : <Badge color="slate">School</Badge>}
                  </td>
                  <td>
                    {s.guardian_phone_1 ? (
                      <div style={{ fontSize: 13 }}>{s.guardian_name_1 || '—'}<div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.guardian_phone_1}</div></div>
                    ) : '—'}
                  </td>
                  <td>
                    {s.invite_code ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '3px 8px' }}>
                        <code style={{ fontWeight: 700, color: '#6d28d9' }}>{s.invite_code}</code>
                        <button className="btn btn-ghost btn-icon" style={{ padding: 2 }} onClick={() => copy(s.invite_code)}>
                          {copied === s.invite_code ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                        </button>
                      </div>
                    ) : '—'}
                  </td>
                  <td>
                    {s.today ? (
                      s.today.absent ? <Badge color="red">Absent</Badge>
                        : s.today.boarded_at && !s.today.dropped_at ? <Badge color="green">On bus</Badge>
                        : s.today.dropped_at ? (s.today.drop_confirmed ? <Badge color="green">Dropped ✔</Badge> : <Badge color="amber">Dropped · confirm</Badge>)
                        : <Badge color="blue">Scheduled</Badge>
                    ) : <Badge color="slate">No trip</Badge>}
                  </td>
                  <td>
                    <span style={{ fontSize: 13 }}>{s.linked_parents?.length || 0}</span>
                    {s.linked_parents?.map((p) => <div key={p.id} style={{ fontSize: 11, color: 'var(--muted)' }}>{p.name}</div>)}
                  </td>
                  <td>
                    <div className="actions">
                      {s.education_level === 'college' && (
                        <button className="btn btn-sm btn-outline" title="Set login password" onClick={() => { setPwModal({ id: s.id, name: s.name }); setPw(''); }}>
                          <KeyRound size={14} />
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(s)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={8}><div className="empty">No students yet. Add one or run an Import.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit student' : 'Add student'} wide>
        <div className="form-grid">
          <div className="field"><label>Full name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Email (college login optional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="student@example.com" /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Class / Grade</label><input value={form.class_grade} onChange={(e) => setForm({ ...form, class_grade: e.target.value })} placeholder="e.g. 5" /></div>
          <div className="field"><label>Section</label><input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="e.g. A" /></div>
          <div className="field">
            <label>Education level</label>
            <select value={form.education_level} onChange={(e) => setForm({ ...form, education_level: e.target.value })}>
              <option value="school">School</option>
              <option value="college">College</option>
            </select>
          </div>
          {form.education_level === 'college' && (
            <div className="field full">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.can_login} onChange={(e) => setForm({ ...form, can_login: e.target.checked })} />
                Allow this student to log in (email + password)
              </label>
            </div>
          )}
          {form.education_level === 'college' && form.can_login && !editing && (
            <div className="field"><label>Initial password (≥6 chars)</label><input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          )}
          <div className="field"><label>Guardian 1 name</label><input value={form.guardian_name_1} onChange={(e) => setForm({ ...form, guardian_name_1: e.target.value })} /></div>
          <div className="field"><label>Guardian 1 phone</label><input value={form.guardian_phone_1} onChange={(e) => setForm({ ...form, guardian_phone_1: e.target.value })} /></div>
          <div className="field"><label>Guardian 2 name</label><input value={form.guardian_name_2} onChange={(e) => setForm({ ...form, guardian_name_2: e.target.value })} /></div>
          <div className="field"><label>Guardian 2 phone</label><input value={form.guardian_phone_2} onChange={(e) => setForm({ ...form, guardian_phone_2: e.target.value })} /></div>
          <div className="field"><label>Emergency contact name</label><input value={form.emergency_name} onChange={(e) => setForm({ ...form, emergency_name: e.target.value })} /></div>
          <div className="field"><label>Emergency contact phone</label><input value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} /></div>
          <div className="field full"><label>Notes</label><textarea rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Users size={16} /> Save student</button>
        </div>
      </Modal>

      <Modal open={importModal} onClose={() => setImportModal(false)} title="Import students" wide>
        <p style={{ fontSize: 13, color: 'var(--slate)', marginBottom: 12 }}>
          Paste rows below — one student per line. Columns: <code>name, email, phone, class, section</code> (email/phone optional). You can include a header row.
        </p>
        <textarea rows="8" className="field" style={{ width: '100%', boxSizing: 'border-box' }} placeholder={'Aarav Sharma, aarav@example.com, +919000000001, 5, A\nMeera Nair, meera@example.com, , 6, B'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setImportModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={importStudents}><Upload size={16} /> Import</button>
        </div>
      </Modal>

      <Modal open={!!pwModal} onClose={() => setPwModal(null)} title={`Set login password — ${pwModal?.name || ''}`}>
        <div className="field"><label>New password (min 6 chars)</label><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Enables this college student to log in with email + password.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setPwModal(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={setPassword}><KeyRound size={16} /> Set password</button>
        </div>
      </Modal>
    </div>
  );
}