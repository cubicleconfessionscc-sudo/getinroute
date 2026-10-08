import React, { useEffect, useState } from 'react';
import { api, todayStr, downloadFile } from '../../api';
import { Badge } from '../../components/ui';
import { Download, FileSpreadsheet } from 'lucide-react';

const METHOD_COLORS = { swipe: 'slate', otp: 'indigo', missed: 'red' };
const EVENT_COLORS = { checkin: 'green', checkout: 'blue' };

export default function CheckInLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [filter, setFilter] = useState({ eventType: '' });

  const load = () => {
    setLoading(true);
    const params = { date };
    if (filter.eventType) params.eventType = filter.eventType;
    api.get('/api/admin/checkin-logs', params).then((data) => {
      setLogs(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [date, filter.eventType]);

  const exportFile = (fmt) => {
    const q = new URLSearchParams({ date });
    if (filter.eventType) q.set('eventType', filter.eventType);
    // Attach the JWT (window.open cannot send the Authorization header).
    const ext = fmt === 'excel' ? '.xlsx' : '';
    downloadFile(`/api/admin/export/checkin-logs${ext}?${q.toString()}`, `getinroute-checkin-logs-${date}${ext}`)
      .catch(() => alert('Export failed. Please try again.'));
  };

  // Full operational Trip Audit (check-in / OTP / check-out / no-show + GPS) as a
  // real Excel workbook. Tenant-scoped on the server.
  const exportTripAudit = () => {
    const q = new URLSearchParams({ from: date, to: date });
    downloadFile(`/api/admin/trip-audit.xlsx?${q.toString()}`, `GetInRoute_Trip_Audit_${date}.xlsx`)
      .catch(() => alert('Export failed. Please try again.'));
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Check-In / Out Logs</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ marginLeft: 'auto' }} />
        <select value={filter.eventType} onChange={(e) => setFilter({ ...filter, eventType: e.target.value })}>
          <option value="">All events</option>
          <option value="checkin">Check-in</option>
          <option value="checkout">Check-out</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={() => exportFile('csv')}><Download size={14} /> CSV</button>
        <button className="btn btn-green btn-sm" onClick={() => exportFile('excel')}><FileSpreadsheet size={14} /> Excel</button>
        <button className="btn btn-green btn-sm" onClick={exportTripAudit}><FileSpreadsheet size={14} /> Export Trip Audit (Excel)</button>
      </div>

      {loading ? <div className="empty">Loading…</div> : logs.length === 0 ? (
        <div className="empty">No logs for this date.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Employee</th>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>Line / Stand</th>
                <th>Event</th>
                <th>OTP</th>
                <th>Location (GPS)</th>
                <th>Trip Date</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id}>
                  <td>{new Date(l.createdAt).toLocaleTimeString()}</td>
                  <td>{l.employeeId?.name || '—'}</td>
                  <td>{l.driverId?.name || '—'}</td>
                  <td>{l.vehicleNumber || '—'}</td>
                  <td>{l.line != null ? `Line ${l.line}` : '—'}{l.stand ? ` · ${l.stand}` : ''}</td>
                  <td><Badge color={EVENT_COLORS[l.eventType] || 'slate'}>{l.eventType}</Badge></td>
                  <td>
                    {l.eventType === 'checkin'
                      ? <Badge color={l.otpVerified ? 'green' : 'amber'}>{l.otpVerified ? 'Verified' : 'Pending'}</Badge>
                      : '—'}
                  </td>
                  <td>
                    {l.hasGps ? (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`} target="_blank" rel="noreferrer">
                        {Number(l.lat).toFixed(5)}, {Number(l.lng).toFixed(5)}
                      </a>
                    ) : <span style={{ color: 'var(--muted)' }}>Not captured</span>}
                  </td>
                  <td>{l.tripDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            Each check-in / check-out records the device GPS position at the moment of the action (open the link to view on a map).
            Employees who missed check-in/check-out appear in the No-Show Report. OTP-verified boardings are marked above.
          </p>
        </div>
      )}
    </div>
  );
}
