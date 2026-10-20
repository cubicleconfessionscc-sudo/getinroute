import React, { useEffect, useState } from 'react';
import { api, todayStr, downloadCsv, downloadFile } from '../../api';
import { Modal, useToast } from '../../components/ui';
import LocationText from '../../components/LocationText';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import { Download, FileSpreadsheet, ShieldAlert, History, UserCheck, RefreshCw, Trash2 } from 'lucide-react';

const TABS = [
  { key: 'report', label: 'Report', icon: <FileSpreadsheet size={15} /> },
  { key: 'log', label: 'No-Show Log', icon: <History size={15} /> },
  { key: 'suspensions', label: 'Suspensions', icon: <ShieldAlert size={15} /> }
];

export default function NoShowsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('report');
  const [rows, setRows] = useState([]);
  const [logRows, setLogRows] = useState([]);
  const [suspRows, setSuspRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [delRow, setDelRow] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPhrase, setClearPhrase] = useState('');
  const [clearResult, setClearResult] = useState(null);

  const deleteLog = async () => {
    if (!delRow) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/no-shows/log/${delRow.id}`);
      toast('✓ No-show record removed');
      setDelRow(null);
      loadLog();
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
    finally { setBusy(false); }
  };

  const clearAll = async () => {
    if (clearPhrase.trim().toUpperCase() !== 'CLEAR ALL NO-SHOWS') return toast('Type CLEAR ALL NO-SHOWS to confirm.', 'err');
    setBusy(true);
    try {
      const r = await api.post('/api/admin/no-shows/clear', { confirm: 'CLEAR ALL NO-SHOWS' });
      setClearResult(r);
      toast(`✓ Removed ${r.deleted} no-show record${r.deleted === 1 ? '' : 's'}`);
      loadLog();
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
    finally { setBusy(false); }
  };

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
        {tab === 'log' && (
          <button className="btn btn-danger btn-sm" onClick={() => { setClearResult(null); setClearPhrase(''); setClearOpen(true); }}><Trash2 size={14} /> Clear No-Show Records</button>
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
                <th>Driver</th>
                <th>Pickup</th>
                <th>No-Show GPS</th>
                <th>Reason</th>
                <th>Marked By</th>
                <th>Role</th>
                <th>Marked At</th>
                <th>Action</th>
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
                  <td>{r.driver_name || '—'}</td>
                  <td>{r.pickup_address || '—'}</td>
                  <td>
                    {r.lat != null && r.lng != null ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                        <LocationText lat={r.lat} lng={r.lng} address={r.pickup_address || r.address || ''} max={60} />
                        <ViewOnMapLink lat={r.lat} lng={r.lng} address={r.pickup_address || r.address || ''} label="Map" />
                      </span>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.marked_by_name || 'system'}</td>
                  <td>{r.marked_by_actual_role || r.marked_by_role || '—'}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-ghost" title="Delete no-show record" onClick={() => setDelRow(r)}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
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

      <Modal open={!!delRow} onClose={() => setDelRow(null)} title="Delete No-Show Record?">
        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 10 }}>
          This removes the record from active reports. The authoritative no-show history is archived (soft-deleted),
          not destroyed, so compliance, audit and suspension calculations stay intact.
        </p>
        {delRow && (
          <div style={{ fontSize: 13, marginBottom: 16, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
            <div><b>Date:</b> {delRow.date || '—'}</div>
            <div><b>Employee:</b> {delRow.emp_name || delRow.employee_id || '—'}{delRow.emp_emp_id ? ` (${delRow.emp_emp_id})` : ''}</div>
            <div><b>Vehicle:</b> {delRow.vehicle_name || delRow.plate || '—'}</div>
            <div><b>Direction:</b> {delRow.direction || '—'}</div>
            <div><b>Slot:</b> {delRow.slot || delRow.slotLabel || '—'}</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setDelRow(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={busy} onClick={deleteLog}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>

      <Modal open={clearOpen} onClose={() => setClearOpen(false)} title="Clear No-Show Records?">
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          This clears no-show records for <b>your company only</b>. Records are archived (soft-deleted) — the underlying
          data is preserved for audit/compliance, and other companies' records are never touched.
        </p>
        {clearResult ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14, textAlign: 'center' }}>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-2)' }}><div style={{ fontSize: 22, fontWeight: 800 }}>{clearResult.deleted}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Deleted</div></div>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-2)' }}><div style={{ fontSize: 22, fontWeight: 800 }}>{clearResult.preserved}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Preserved</div></div>
            <div style={{ padding: 12, borderRadius: 10, background: 'var(--surface-2)' }}><div style={{ fontSize: 22, fontWeight: 800 }}>{clearResult.failed}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Failed</div></div>
          </div>
        ) : (
          <div className="field" style={{ marginTop: 14 }}>
            <label>Type <b>CLEAR ALL NO-SHOWS</b> to confirm</label>
            <input value={clearPhrase} onChange={(e) => setClearPhrase(e.target.value)} placeholder="CLEAR ALL NO-SHOWS" autoFocus />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setClearOpen(false)}>Close</button>
          {!clearResult && (
            <button className="btn btn-danger" disabled={busy || clearPhrase.trim().toUpperCase() !== 'CLEAR ALL NO-SHOWS'} onClick={clearAll}>
              {busy ? 'Clearing…' : 'Clear No-Show Records'}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}