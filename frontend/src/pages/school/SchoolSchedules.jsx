import React, { useEffect, useState } from 'react';
import { api, todayStr } from '../../api';
import { useToast, Modal, Badge } from '../../components/ui';
import { Plus, Pencil, Trash2, CalendarClock, Users } from 'lucide-react';

const empty = { student_id: '', vehicle_id: '', route_id: '', date: todayStr(), pickup_time: '', drop_time: '', sequence: 1 };

export default function SchoolSchedules() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState([]);
  const [students, setStudents] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const loadStudents = () => api.get('/api/school/students').then((r) => setStudents(Array.isArray(r) ? r : [])).catch(() => {});
  const loadVehicles = () => api.get('/api/school/vehicles').then((r) => setVehicles(Array.isArray(r) ? r : [])).catch(() => {});
  const loadRoutes = () => api.get('/api/school/routes').then((r) => setRoutes(Array.isArray(r) ? r : [])).catch(() => {});
  const load = () => api.get('/api/school/schedules', { date }).then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});

  useEffect(() => { load(); loadStudents(); loadVehicles(); loadRoutes(); }, [date]);

  const openEdit = (s) => {
    if (s) {
      setEditing(s.id);
      setForm({ student_id: String(s.employee_id), vehicle_id: s.vehicle_id ? String(s.vehicle_id) : '', route_id: s.route_id ? String(s.route_id) : '', date: s.date, pickup_time: s.pickup_time || '', drop_time: s.drop_time || '', sequence: s.sequence || 1 });
    } else { setEditing(null); setForm({ ...empty, date }); }
    setModal(true);
  };

  const save = async () => {
    try {
      const payload = {
        student_id: Number(form.student_id), date: form.date, pickup_time: form.pickup_time || null, drop_time: form.drop_time || null, sequence: Number(form.sequence) || 1,
        vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null, route_id: form.route_id ? Number(form.route_id) : null
      };
      if (!payload.student_id) throw new Error('Select a student');
      if (editing) await api.put(`/api/school/schedules/${editing}`, payload);
      else await api.post('/api/school/schedules', payload);
      toast(editing ? 'Schedule updated' : 'Trip scheduled — parents were notified');
      setModal(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (s) => {
    if (!confirm(`Remove ${s.student_name}'s trip on ${s.date}?`)) return;
    try { await api.del(`/api/school/schedules/${s.id}`); toast('Schedule removed'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Schedules</div>
          <div className="page-sub">Plan which student rides which bus on which day.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: '8px 10px' }} />
          <button className="btn btn-primary" onClick={() => openEdit(null)}><Plus size={16} /> Schedule trip</button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        {[
          { lbl: 'Trips', num: list.filter((s) => ['confirmed', 'in_progress'].includes(s.status)).length },
          { lbl: 'Boarded', num: list.filter((s) => s.boarded_at).length },
          { lbl: 'Absent', num: list.filter((s) => s.absent).length },
          { lbl: 'Drops confirmed', num: list.filter((s) => s.drop_confirmed).length }
        ].map((c) => (
          <div className="stat" key={c.lbl}>
            <div className={`ico ${c.lbl === 'Absent' ? 'ico-red' : c.lbl === 'Boarded' ? 'ico-green' : 'ico-indigo'}`} style={{ fontSize: 18 }}><CalendarClock size={18} /></div>
            <div className="num">{c.num}</div><div className="lbl">{c.lbl} · {date}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Student</th><th>Time</th><th>Bus</th><th>Route</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((s, idx) => (
                <tr key={s.id}>
                  <td>{s.sequence ?? idx + 1}</td>
                  <td>
                    <b>{s.student_name}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.class_grade ? `${s.class_grade}${s.section ? ' · ' + s.section : ''}` : s.education_level || ''}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {s.pickup_time ? <div>Pick {s.pickup_time}</div> : null}
                    {s.drop_time ? <div style={{ color: 'var(--muted)' }}>Drop {s.drop_time}</div> : null}
                  </td>
                  <td style={{ fontSize: 13 }}>{s.vehicle_name || '—'}{s.plate ? ` · ${s.plate}` : ''}</td>
                  <td style={{ fontSize: 13 }}>{s.route_name || '—'}</td>
                  <td>
                    {s.absent ? <Badge color="red">Absent</Badge>
                      : s.boarded_at && !s.drop_confirmed && !s.dropped_at ? <Badge color="green">On bus</Badge>
                      : s.dropped_at ? (s.drop_confirmed ? <Badge color="green">Dropped ✔</Badge> : <Badge color="amber">Drop · OTP</Badge>)
                      : s.status === 'completed' ? <Badge color="slate">Completed</Badge>
                      : <Badge color="blue">Scheduled</Badge>}
                    {s.boarded_at && <div style={{ fontSize: 11, color: 'var(--muted)' }}>@{String(s.boarded_at).slice(11, 16)}</div>}
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => del(s)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7}><div className="empty">No trips scheduled for this date.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit schedule' : 'Schedule a trip'}>
        <div className="form-grid">
          <div className="field">
            <label>Student *</label>
            <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
              <option value="">— Select student —</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.class_grade ? ` (${s.class_grade}${s.section ? ' ' + s.section : ''})` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Date</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="field"><label>Pickup time</label><input type="time" value={form.pickup_time} onChange={(e) => setForm({ ...form, pickup_time: e.target.value })} /></div>
          <div className="field"><label>Drop time</label><input type="time" value={form.drop_time} onChange={(e) => setForm({ ...form, drop_time: e.target.value })} /></div>
          <div className="field"><label>Bus</label>
            <select value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
              <option value="">— Auto from route (or none) —</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_name} {v.plate ? `· ${v.plate}` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Route (optional)</label>
            <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
              <option value="">— No route —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Pickup order #</label><input type="number" value={form.sequence} onChange={(e) => setForm({ ...form, sequence: e.target.value })} /></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Parents of this student will be notified by SMS and push when the trip is scheduled.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Users size={16} /> {editing ? 'Save changes' : 'Schedule'}</button>
        </div>
      </Modal>
    </div>
  );
}