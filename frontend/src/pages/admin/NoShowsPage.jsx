import React, { useEffect, useState } from 'react';
import { api, todayStr, downloadCsv, downloadFile } from '../../api';
import { Download, FileSpreadsheet, ShieldAlert, History, UserCheck, RefreshCw } from 'lucide-react';

const TABS = [
  { key: 'report', label: 'Report', icon: <FileSpreadsheet size={15} /> },
  { key: 'log', label: 'No-Show Log', icon: <History size={15} /> },
  { key: 'suspensions', label: 'Suspensions', icon: <ShieldAlert size={15} /> }
];

export default function NoShowsPage() {
  const [tab, setTab] = useState('report');
  const [rows, setRows] = useState([]);
  const [logRows, setLogRows] = useState([]);
  const [suspRows, setSuspRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const loadReport = () => {
    setLoading(true);
    api.get('/api/admin/no-shows', { date }).then((data) => {
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => { setRows([]); setLoading(false); });
  };
  const loadLog = () => {
    api.get('/api/admin/no-shows/log').then((d) => setLogRows(Array.isArray(d) ? d : [])).catch(() => setLogRows([]));
  };
  const loadSuspensions = () => {
    api.get('/api/admin/suspensions').then((d) => setSuspRows(Array.isArray(d) ? d : [])).catch(() => setSuspRows([]));
  };

  useEffect(() => {
    if (tab === 'report') loadReport();
    else if (tab === 'log') loadLog();
    else loadSuspensions();
  }, [tab, date]);

  const reactivate = (s) => {
    const adminReason = window.prompt('Administrative reason for reactivation (shown in audit trail):', s.reason ? `Reinstated (${s.reason})` : 'Reinstated by admin');
    if (adminReason === null) return;
    setBusy(true); setMsg('');
    api.post(`/api/admin/employees/${s.employee_id}/suspension/reactivate`, { adminReason })
      .then(() => { setMsg('Employee reinstated.'); loadSuspensions(); })
      .catch((e) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, marginRight: 12 }}>No-Shows &amp; Suspensions</h2>
        {TABS.map((t) => (
          <button key={t.key} className={`btn ${tab === t.key ? 'btn-blue' : 'btn-outline'} btn-sm`} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
        {tab === 'report' && (
          <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`/api/admin/export/no-shows?date=${date}`, `no-shows-${date}.csv`).catch((e) => setMsg(e.message))}><Download size={14} /> CSV</button>
            <button className="btn btn-green btn-sm" onClick={() => downloadFile(`/api/admin/export/no-shows.xlsx?date=${date}`, `no-shows-${date}.xlsx`).catch((e) => setMsg(e.message))}><FileSpreadsheet size={14} /> Excel</button>
          </>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => (tab === 'report' ? loadReport() : tab === 'log' ? loadLog() : loadSuspensions())}><RefreshCw size={14} /> Refresh</button>
        <span style={{ marginLeft: 'auto' }} />
      </div>

      {msg && <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: 'rgba(34,211,238,.12)', color: '#22d3ee' }}>{msg}</div>}

      {tab === 'report' && (loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
        <div className="empty">No no-shows found for this date.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Vehicle</th>
                <th>Direction</th>
                <th>Slot</th>
                <th>Marked At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const empStop = (r.dropSequence || []).find((s) => s.noShow && s.employeeId);
                return (
                  <tr key={r._id}>
                    <td>{r.date || r.createdAt?.slice(0, 10) || '—'}</td>
                    <td>{empStop?.employeeId?.name || '—'}</td>
                    <td>{r.vehicleNumber || r.vehicleId?.vehicleNumber || '—'}</td>
                    <td>{r.direction || '—'}</td>
                    <td>{r.slotLabel || '—'}</td>
                    <td>{empStop?.noShowMarkedAt ? new Date(empStop.noShowMarkedAt).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'log' && (logRows.length === 0 ? <div className="empty">No recorded no-shows yet.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Emp ID</th>
                <th>Department</th>
                <th>Vehicle</th>
                <th>Reason</th>
                <th>Marked By</th>
                <th>Role</th>
                <th>Marked At</th>
              </tr>
            </thead>
            <tbody>
              {logRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.emp_name || r.employee_id}</td>
                  <td>{r.emp_emp_id || '—'}</td>
                  <td>{r.department || '—'}</td>
                  <td>{r.vehicle_name || r.plate || '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.marked_by_name || 'system'}</td>
                  <td>{r.marked_by_actual_role || r.marked_by_role || '—'}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'suspensions' && (suspRows.length === 0 ? <div className="empty">No employees are currently suspended.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Emp ID</th>
                <th>Department</th>
                <th>No-Shows</th>
                <th>Threshold</th>
                <th>Reason</th>
                <th>Suspended On</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {suspRows.map((s) => (
                <tr key={s.id}>
                  <td>{s.emp_name || s.employee_id}</td>
                  <td>{s.emp_emp_id || '—'}</td>
                  <td>{s.department || '—'}</td>
                  <td>{s.no_show_count}</td>
                  <td>{s.threshold}</td>
                  <td>{s.reason || '—'}</td>
                  <td>{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-green btn-sm" disabled={busy} onClick={() => reactivate(s)}>
                      <UserCheck size={14} /> Reactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}