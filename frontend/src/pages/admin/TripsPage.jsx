import React, { useEffect, useState } from 'react';
import { api, downloadCsv } from '../../api';
import { useAuth } from '../../auth';
import { Badge, statusColor, statusLabel, useToast, Modal } from '../../components/ui';
import { Download, ChevronDown, ChevronRight, Truck } from 'lucide-react';

export default function TripsPage() {
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';
  const toast = useToast();
  const [runs, setRuns] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [editRun, setEditRun] = useState(null);
  const [editForm, setEditForm] = useState({ pickup_time: '', drop_time: '' });
  const [busy, setBusy] = useState(false);

  const openEdit = (r) => {
    const slot = r.slotLabel && /^\d{2}:\d{2}/.test(r.slotLabel) ? r.slotLabel.slice(0, 5) : '';
    setEditRun(r);
    setEditForm({ pickup_time: slot, drop_time: '' });
  };

  const saveEdit = async () => {
    if (!editRun) return;
    const stops = (editRun.dropSequence || []).filter((s) => s.scheduleId);
    if (!stops.length) return toast('This trip has no editable schedule rows.', 'err');
    setBusy(true);
    let ok = 0;
    try {
      for (const s of stops) {
        try {
          await api.put(`/api/admin/schedules/${s.scheduleId}`, {
            pickup_time: editForm.pickup_time || undefined,
            drop_time: editForm.drop_time || undefined
          });
          ok += 1;
        } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
      }
      toast(ok ? `✓ Trip updated successfully (${ok} stop${ok === 1 ? '' : 's'})` : 'Nothing updated');
      setEditRun(null); load();
    } finally { setBusy(false); }
  };

  const delRun = async (r) => {
    if (!window.confirm('Are you sure you want to delete this trip? This removes its schedule(s) only — the route, employees, drivers and vehicles are kept.')) return;
    const stops = (r.dropSequence || []).filter((s) => s.scheduleId);
    if (!stops.length) return toast('This trip has no schedule rows to delete.', 'err');
    setBusy(true);
    let ok = 0;
    try {
      for (const s of stops) {
        try { await api.del(`/api/admin/schedules/${s.scheduleId}`); ok += 1; }
        catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
      }
      toast(ok ? '✓ Trip deleted' : 'Nothing deleted');
      load();
    } finally { setBusy(false); }
  };

  const load = () => {
    api.get('/api/admin/runs').then((r) => setRuns(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const filtered = runs.filter((r) => {
    if (filter && r.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const v = r.vehicleId || {};
    const d = r.driverId || {};
    const haystack = [
      v.vehicleNumber, v.vehicleType, v.line,
      d.name, d.phone,
      r.slotLabel, r.vendorName, r.status,
      r._id,
      ...(r.dropSequence || []).map((s) => {
        const emp = s.employeeId || {};
        return [emp.name, emp.email, emp.employeeId, emp.pickupLocation?.address, emp.dropLocation?.address].filter(Boolean).join(' ');
      })
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });

  const exportRuns = async () => {
    try {
      await downloadCsv('/api/admin/runs/export', 'getinroute-cab-runs.xlsx');
      toast('Cab runs spreadsheet downloaded');
    } catch (e) { toast(e.message, 'err'); }
  };

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const statusCounts = {};
  runs.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">All Trips & Cab Runs</div>
          <div className="page-sub">Every allotted cab run with stop sequences, driver info, and trip status.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search vehicle, driver, employee, trip ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '7px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, minWidth: 260 }}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '7px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
            <option value="">All statuses</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          {!isVendor && <button className="btn btn-primary" onClick={exportRuns}><Download size={16} /> Export spreadsheet</button>}
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        {[
          { label: 'Total runs', value: runs.length, color: 'ico-indigo' },
          { label: 'Assigned', value: statusCounts.assigned || 0, color: 'ico-amber' },
          { label: 'In progress', value: statusCounts.in_progress || 0, color: 'ico-green' },
          { label: 'Completed', value: statusCounts.completed || 0, color: 'ico-blue' }
        ].map((s, i) => (
          <div className="stat" key={i}>
            <div className={`ico ${s.color}`}><Truck size={20} /></div>
            <div className="num">{s.value}</div>
            <div className="lbl">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Date</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Line</th>
                <th>Direction</th>
                <th>Shift</th>
                <th>Stops</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No trips found</td></tr>
              )}
              {filtered.map((r) => {
                const v = r.vehicleId || {};
                const d = r.driverId || {};
                const isOpen = expanded[r._id];
                return (
                  <React.Fragment key={r._id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggle(r._id)}>
                      <td>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td style={{ fontWeight: 600 }}>{r.date ? new Date(r.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{v.vehicleNumber || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v.vehicleType || ''}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{d.name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.phone || ''}</div>
                      </td>
                      <td>{v.line ? <Badge color="violet">L{v.line}</Badge> : '—'}</td>
                      <td>{r.direction === 'toOffice' ? '🏢 Login' : '🏠 Logout'}</td>
                      <td style={{ fontSize: 13 }}>{r.slotLabel || '—'}</td>
                      <td><Badge color="indigo">{r.dropSequence?.length || 0}</Badge></td>
                      <td>
                        <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
                        {r.vendorName && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Vendor: {r.vendorName}</div>}
                      </td>
                      <td>
                        <div className="actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-sm btn-outline" onClick={() => openEdit(r)}>Edit</button>
                          <button className="btn btn-sm btn-ghost" title="Delete trip" onClick={() => delRun(r)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '2px solid var(--primary)' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                            Stop Sequence ({r.dropSequence?.length || 0} stops)
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>#</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>Employee</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>ID</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>Pickup</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>Drop</th>
                                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)' }}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(r.dropSequence || [])
                                .sort((a, b) => a.order - b.order)
                                .map((s, i) => {
                                  const emp = s.employeeId || {};
                                  return (
                                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                      <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--primary)' }}>{i + 1}</td>
                                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{emp.name || '—'}</td>
                                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{emp.employeeId || '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: 12 }}>{emp.pickupLocation?.address || '—'}</td>
                                      <td style={{ padding: '6px 8px', fontSize: 12 }}>{emp.dropLocation?.address || emp.homeLocation?.address || '—'}</td>
                                      <td style={{ padding: '6px 8px' }}>
                                        <Badge color={statusColor(s.status || 'pending')}>{statusLabel(s.status || 'pending')}</Badge>
                                        {s.checkedInAt && <div style={{ fontSize: 11, color: 'var(--muted)' }}>In: {new Date(s.checkedInAt).toLocaleTimeString()}</div>}
                                        {s.checkedOutAt && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Out: {new Date(s.checkedOutAt).toLocaleTimeString()}</div>}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                            {r.startedAt && <span>Started: {new Date(r.startedAt).toLocaleString()} · </span>}
                            {r.completedAt && <span>Completed: {new Date(r.completedAt).toLocaleString()}</span>}
                            {!r.startedAt && !r.completedAt && <span>No timing data yet</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editRun} onClose={() => setEditRun(null)} title="Edit Trip">
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          Updating the schedule time applies to all {editRun?.dropSequence?.length || 0} stop(s) in this trip.
          The route, employees, driver and vehicle are not changed.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label>Pickup time</label><input type="time" value={editForm.pickup_time} onChange={(e) => setEditForm({ ...editForm, pickup_time: e.target.value })} /></div>
          <div className="field"><label>Drop time</label><input type="time" value={editForm.drop_time} onChange={(e) => setEditForm({ ...editForm, drop_time: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setEditRun(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </Modal>
    </div>
  );
}
