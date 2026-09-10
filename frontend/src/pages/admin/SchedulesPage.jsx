import React, { useEffect, useState } from 'react';
import { api, todayStr } from '../../api';
import { Modal, Badge, statusColor, statusLabel, useToast, LiveMap } from '../../components/ui';
import { Plus, Pencil, Trash2, MapPin, Check, X, Clock } from 'lucide-react';

const empty = { employee_id: '', vehicle_id: '', route_id: '', date: '', pickup_time: '', drop_time: '', login_time: '', logout_time: '', sequence: 1, status: 'confirmed', line: '', driver_id: '', direction: 'toOffice' };

const pickDriverForVehicle = (vid, vehicles, drivers) => {
  const v = vehicles.find((x) => String(x.id) === String(vid));
  if (!v) return '';
  const d = drivers.find((x) =>
    (v.driver_name && String(x.name) === String(v.driver_name)) ||
    (v.driver_phone && String(x.phone) === String(v.driver_phone))
  );
  return d ? String(d.id) : '';
};

export default function SchedulesPage() {
  const toast = useToast();
  const [sched, setSched] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [routePreview, setRoutePreview] = useState(null);
  const [editIsRequest, setEditIsRequest] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const today = todayStr();

  const pending = sched.filter((s) => s.status === 'requested');
  const isLogin = (s) => (s.direction === 'toHome') ? false : Boolean(s.pickup_time || s.login_time);
  const reqLabel = (s) => {
    const t = s.pickup_time || s.login_time || s.drop_time || s.logout_time;
    const dir = isLogin(s) ? 'Login' : 'Logout';
    return `${dir}${t ? ` ${t}` : ''}${s.pickup_point ? ` · ${s.pickup_point}` : ''}`;
  };

  const load = () => {
    api.get('/api/admin/schedules').then((r) => setSched(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/admin/users', { role: 'employee' }).then((l) => setEmployees((Array.isArray(l) ? l : []).filter((u) => u.status === 'approved'))).catch(() => {});
    api.get('/api/admin/vehicles').then((r) => setVehicles(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/admin/drivers').then((r) => setDrivers(Array.isArray(r) ? r.filter((d) => d.approved === 1) : [])).catch(() => {});
    api.get('/api/admin/routes').then((r) => setRoutes(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const selectedVehicle = vehicles.find((v) => String(v.id) === String(form.vehicle_id));

  const save = async () => {
    if (!form.employee_id) return toast('Select an employee', 'err');
    const isLoginDir = form.direction !== 'toHome';
    const payload = {
      ...form,
      employee_id: Number(form.employee_id),
      vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null,
      route_id: form.route_id ? Number(form.route_id) : null,
      sequence: Number(form.sequence),
      driver_id: form.driver_id ? Number(form.driver_id) : null,
      direction: isLoginDir ? 'toOffice' : 'toHome',
      pickup_time: isLoginDir ? (form.pickup_time || '') : '',
      login_time: isLoginDir ? (form.login_time || '') : '',
      drop_time: isLoginDir ? '' : (form.drop_time || ''),
      logout_time: isLoginDir ? '' : (form.logout_time || ''),
      status: form.status || 'confirmed'
    };
    try {
      if (editing && editIsRequest) {
        await api.post(`/api/admin/schedules/${editing}/approve`, payload);
        toast('Request approved and confirmed');
      } else if (editing) await api.put(`/api/admin/schedules/${editing}`, payload);
      else await api.post('/api/admin/schedules', payload);
      toast(editing ? 'Schedule updated' : 'Employee scheduled — notified by app');
      setModal(false); setEditIsRequest(false); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const decideRequest = async (s, action) => {
    try {
      if (action === 'reject' && !confirm(`Reject ${s.employee_name}'s cab request for ${s.date}?`)) return;
      await api.post(`/api/admin/schedules/${s.id}/${action}`);
      toast(action === 'approve' ? 'Request approved — employee notified' : 'Request rejected');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const del = async (id) => {
    if (!confirm('Permanently delete this schedule? The passenger will NOT be notified. Prefer Cancel with a reason instead.')) return;
    await api.del(`/api/admin/schedules/${id}`); toast('Schedule removed'); load();
  };

  const doCancel = async () => {
    if (!cancelFor) return;
    if (!cancelReason.trim()) return toast('A reason is required for an audited cancellation', 'err');
    try {
      await api.post(`/api/admin/schedules/${cancelFor.id}/cancel`, { reason: cancelReason.trim() });
      toast(`Schedule for ${cancelFor.employee_name || ''} cancelled — passenger notified`);
      setCancelFor(null); setCancelReason(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const setStatus = async (s, status) => {
    await api.put(`/api/admin/schedules/${s.id}`, { status });
    toast(`Schedule marked ${statusLabel(status)}`);
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Schedules</div>
          <div className="page-sub">Assign employees to cabs, routes and timings. Employees get notified instantly.</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setEditIsRequest(false); setForm({ ...empty, date: today }); setModal(true); }}><Plus size={16} /> New schedule</button>
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={15} /> Employee-requested cab — awaiting approval ({pending.length})
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {pending.map((s) => (
              <div className="card" key={s.id} style={{ borderLeft: '3px solid #f59e0b', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 15 }}>{s.employee_name}</b>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{s.emp_id}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--slate)', flex: 1 }}>
                  <div>{s.date} · {reqLabel(s)}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Requested on {s.created_at} · not auto-approved</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decideRequest(s, 'approve')}><Check size={15} /> Approve</button>
                  <button className="btn btn-outline" onClick={() => {
                    setEditing(s.id);
                    setEditIsRequest(true);
                    setForm({ employee_id: s.employee_id, vehicle_id: '', route_id: s.route_id || '', date: s.date, pickup_time: s.pickup_time, drop_time: s.drop_time, login_time: s.login_time, logout_time: s.logout_time, sequence: s.sequence, status: 'requested', line: '', driver_id: '', direction: s.direction === 'toHome' ? 'toHome' : 'toOffice' });
                    setModal(true);
                  }}><Pencil size={14} /> Edit</button>
                  <button className="btn btn-danger" onClick={() => decideRequest(s, 'reject')}><X size={15} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Employee</th><th>Vehicle</th><th>Driver</th><th>Route</th><th>Trip timing</th><th>Office (login/out)</th><th>Seq</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {sched.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.date}</td>
                  <td><b>{s.employee_name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.emp_id}</div></td>
                  <td style={{ fontSize: 13 }}>{s.vehicle_name || '—'}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.plate} · L{s.line} T{s.trip}</div></td>
                  <td>{s.driver_account || s.driver_name ? <><b>{s.driver_account || s.driver_name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.driver_account ? s.driver_emp_id : (s.driver_phone || 'legacy')}</div></> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={{ fontSize: 13, maxWidth: 170 }}>{s.route_name || '—'}</td>
                  <td style={{ fontSize: 13 }}>{reqLabel(s)}</td>
                  <td style={{ fontSize: 13 }}>{s.login_time || '—'} → {s.logout_time || '—'}</td>
                  <td><Badge color="violet">{s.sequence}</Badge></td>
                  <td>
                    <select value={s.status} onChange={(e) => setStatus(s, e.target.value)} style={{ padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8 }}>
                      {['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'].map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm btn-outline" onClick={() => { setEditing(s.id); setForm({ employee_id: s.employee_id, vehicle_id: s.vehicle_id || '', route_id: s.route_id || '', date: s.date, pickup_time: s.pickup_time, drop_time: s.drop_time, login_time: s.login_time, logout_time: s.logout_time, sequence: s.sequence, status: s.status, driver_id: pickDriverForVehicle(s.vehicle_id, vehicles, drivers), direction: s.direction === 'toHome' ? 'toHome' : 'toOffice' }); setModal(true); }}><Pencil size={14} /></button>
                      {s.status !== 'cancelled' && s.status !== 'completed' && (
                        <button className="btn btn-sm btn-outline" title="Cancel with reason (notifies passenger)" onClick={() => { setCancelFor(s); setCancelReason(''); }}><X size={14} /></button>
                      )}
                      <button className="btn btn-sm btn-danger" title="Permanently delete (no passenger notification)" onClick={() => del(s.id)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setEditIsRequest(false); }} title={editIsRequest ? 'Approve & edit employee request' : (editing ? 'Edit schedule' : 'Schedule employee')} wide>
        <div className="form-grid">
          <div className="field"><label>Employee</label>
            <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
              <option value="">Select employee…</option>
              {employees.map((u) => <option key={u._id || u.id} value={u._id || u.id}>{u.employeeId || u.emp_id || '—'} — {u.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Date</label><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="field"><label>Line</label>
            <select value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value, vehicle_id: '' })}>
              <option value="">All lines…</option>
              {[...new Set(vehicles.map((v) => v.line))].sort((a, b) => a - b).map((l) => <option key={l} value={l}>Line {l}</option>)}
            </select>
          </div>
          <div className="field"><label>Vehicle (leave blank to auto-assign)</label>
            <select value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value, driver_id: e.target.value ? pickDriverForVehicle(e.target.value, vehicles, drivers) : form.driver_id })}>
              <option value="">Auto assign…</option>
              {vehicles.filter((v) => !form.line || String(v.line) === String(form.line)).map((v) => <option key={v.id} value={v.id}>{v.vehicle_name} · L{v.line} T{v.trip}{v.stand ? ` · ${v.stand}` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>Driver (for this cab, optional)</label>
            <select value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">Select driver…</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.emp_id || d.phone || 'no id'}</option>)}
            </select>
          </div>
          {selectedVehicle?.stand && (
            <div className="field"><label>Stand</label>
              <input value={selectedVehicle.stand} readOnly style={{ background: '#f8fafc' }} />
            </div>
          )}
          <div className="field"><label>Route</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
                <option value="">Select route…</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" className="btn btn-outline btn-icon" title="Preview route on map" onClick={() => {
                const r = routes.find((x) => String(x.id) === String(form.route_id));
                if (r && Array.isArray(r.stops) && r.stops.length) setRoutePreview(r);
              }}><MapPin size={16} /></button>
            </div>
          </div>
          <div className="field"><label>Trip direction</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-sm" style={form.direction === 'toOffice' ? { background: '#4f46e5', color: '#fff' } : {}} onClick={() => setForm({ ...form, direction: 'toOffice' })}>Login (pick up)</button>
              <button type="button" className="btn btn-sm" style={form.direction === 'toHome' ? { background: '#4f46e5', color: '#fff' } : {}} onClick={() => setForm({ ...form, direction: 'toHome' })}>Logout (drop off)</button>
            </div>
          </div>
          {form.direction === 'toOffice' ? (
            <>
              <div className="field"><label>Login pickup time</label><input type="time" value={form.pickup_time} onChange={(e) => setForm({ ...form, pickup_time: e.target.value })} /></div>
              <div className="field"><label>Office login time</label><input type="time" value={form.login_time} onChange={(e) => setForm({ ...form, login_time: e.target.value })} /></div>
            </>
          ) : (
            <>
              <div className="field"><label>Logout drop time</label><input type="time" value={form.drop_time} onChange={(e) => setForm({ ...form, drop_time: e.target.value })} /></div>
              <div className="field"><label>Office logout time</label><input type="time" value={form.logout_time} onChange={(e) => setForm({ ...form, logout_time: e.target.value })} /></div>
            </>
          )}
          <div className="field"><label>{form.direction === 'toOffice' ? 'Pickup sequence' : 'Drop sequence'}</label><input type="number" min={1} value={form.sequence} onChange={(e) => setForm({ ...form, sequence: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => { setModal(false); setEditIsRequest(false); }}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{editIsRequest ? 'Approve request' : (editing ? 'Save changes' : 'Create schedule')}</button>
        </div>
      </Modal>

      <Modal open={!!routePreview} onClose={() => setRoutePreview(null)} title={`Route: ${routePreview?.name || ''}`} wide>
        {routePreview && (
          <LiveMap
            height="360px"
            zoom={12}
            stops={Array.isArray(routePreview.stops) ? routePreview.stops : []}
            polyline={[]}
          />
        )}
      </Modal>

      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title={`Cancel ride — ${cancelFor?.employee_name || ''}`}>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
          Cancelling this ride notifies the passenger by app and re-sequences the cab run automatically. The reason is kept in the trip audit trail.
        </p>
        <div className="field"><label>Reason for cancellation *</label>
          <textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Employee reported sick / trip cancelled by admin / vehicle breakdown" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setCancelFor(null)}>Keep the ride</button>
          <button className="btn btn-danger" onClick={doCancel}><X size={16} /> Cancel this ride</button>
        </div>
      </Modal>
    </div>
  );
}
