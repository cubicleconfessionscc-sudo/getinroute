import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Modal, useToast } from '../../components/ui';
import { Trash2 } from 'lucide-react';

// Admin/Vendor view of the Trip · Line · Stand each driver selected in the
// Driver app. Company/vendor scoped server-side. Deleting an assignment removes
// ONLY the assignment relationship — never the driver account or any history.
export default function DriverAssignmentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/api/admin/driver-assignments')
      .then((r) => setRows(Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : [])))
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const hasAssignment = (r) => !!(r.trip || r.line || r.stand || r.assigned_at);

  const confirmDelete = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/driver-assignments/${del.id}`);
      toast('✓ Driver assignment deleted');
      setDel(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error || e.message || 'Delete failed', 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Driver Assignments</div>
          <div className="page-sub">The Trip · Line · Stand each driver selected in the Driver app.</div>
        </div>
        <button className="btn btn-outline" onClick={load}>Refresh</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Driver</th><th>Driver ID</th><th>Trip</th><th>Line</th><th>Stand</th><th>Vehicle</th><th>Assigned</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td>{r.emp_id || '—'}</td>
                  <td>{r.trip || '—'}</td>
                  <td>{r.line ? <Badge color="violet">Line {r.line}</Badge> : '—'}</td>
                  <td>{r.stand || '—'}</td>
                  <td>{r.vehicle || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{r.assigned_at || '—'}</td>
                  <td>
                    {hasAssignment(r) ? (
                      <button className="btn btn-sm btn-ghost" title="Delete driver assignment" onClick={() => setDel(r)}>
                        <Trash2 size={14} /> Delete
                      </button>
                    ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">No driver assignments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!del} onClose={() => setDel(null)} title="Delete Driver Assignment?">
        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 8 }}>Are you sure you want to remove this driver assignment?</p>
        {del && (
          <div style={{ fontSize: 13, marginBottom: 16, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
            <div><b>{del.name}</b> {del.emp_id ? <span style={{ color: 'var(--muted)' }}>({del.emp_id})</span> : null}</div>
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>
              {[del.trip && `Trip: ${del.trip}`, del.line && `Line: ${del.line}`, del.stand && `Stand: ${del.stand}`].filter(Boolean).join(' · ') || 'Assignment'}
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          This removes only the assignment. The driver account, vehicle, route, trips and all check-in/out history are kept.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setDel(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={busy} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>
    </div>
  );
}
