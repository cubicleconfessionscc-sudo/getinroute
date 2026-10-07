import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge } from '../../components/ui';

// Admin/Vendor view of the Trip · Line · Stand each driver selected in the
// Driver app. Company/vendor scoped server-side.
export default function DriverAssignmentsPage() {
  const [rows, setRows] = useState([]);
  const load = () => {
    api.get('/api/admin/driver-assignments')
      .then((r) => setRows(Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : [])))
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

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
              <tr><th>Driver</th><th>Driver ID</th><th>Trip</th><th>Line</th><th>Stand</th><th>Vehicle</th><th>Assigned</th></tr>
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
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="empty">No driver assignments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
