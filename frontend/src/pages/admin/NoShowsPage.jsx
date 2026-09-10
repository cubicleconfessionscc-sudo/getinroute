import React, { useEffect, useState } from 'react';
import { api, todayStr } from '../../api';
import { Download, FileSpreadsheet } from 'lucide-react';

export default function NoShowsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayStr());

  const load = () => {
    setLoading(true);
    api.get('/api/admin/no-shows', { date }).then((data) => {
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [date]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>No-Show Report</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-outline btn-sm" onClick={() => window.open(`/api/admin/export/no-shows?date=${date}`, '_blank')}><Download size={14} /> CSV</button>
        <button className="btn btn-green btn-sm" onClick={() => window.open(`/api/admin/export/no-shows?date=${date}`, '_blank')}><FileSpreadsheet size={14} /> Excel</button>
        <span style={{ marginLeft: 'auto' }} />
      </div>

      {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
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
      )}
    </div>
  );
}
