import React, { useEffect, useState } from 'react';
import { api, todayStr, downloadCsv } from '../../api';
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
    window.open(`/api/admin/export/checkin-logs?${q.toString()}`, '_blank');
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
                <th>Event</th>
                <th>Method</th>
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
                  <td><Badge color={EVENT_COLORS[l.eventType] || 'slate'}>{l.eventType}</Badge></td>
                  <td><Badge color={METHOD_COLORS[l.method] || 'slate'}>{l.method === 'swipe' ? 'Swipe / App' : l.method === 'otp' ? 'OTP Verified' : l.method}</Badge></td>
                  <td>{l.tripDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            Employees who missed check-in/check-out for scheduled trips appear in the No-Show Report. OTP-verified entries are marked above.
          </p>
        </div>
      )}
    </div>
  );
}
