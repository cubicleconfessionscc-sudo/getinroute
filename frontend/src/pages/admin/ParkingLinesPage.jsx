import React, { useEffect, useState } from 'react';
import { api, downloadCsv } from '../../api';
import { Download } from 'lucide-react';

export default function ParkingLinesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [line, setLine] = useState('');

  const load = () => {
    setLoading(true);
    const params = line ? { line } : undefined;
    api.get('/api/admin/parking-lines', params).then((data) => {
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [line]);

  const exportCsv = async () => {
    try {
      const url = line ? `/api/admin/parking-lines?format=csv&line=${encodeURIComponent(line)}` : '/api/admin/parking-lines?format=csv';
      await downloadCsv(url, 'getinroute-parking-lines.csv');
    } catch (e) { /* ignore */ }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Parking Lines</h2>
        <input
          placeholder="Filter by line (e.g. L12)"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6 }}
        />
        <button className="btn btn-outline btn-sm" onClick={exportCsv}><Download size={14} /> CSV</button>
      </div>

      {loading ? <div className="empty">Loading...</div> : rows.length === 0 ? (
        <div className="empty">No parking-line assignments yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Vehicle</th><th>Plate</th><th>Driver</th><th>Line</th><th>Date</th><th>Time</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.vehicle_name || '--'}</td>
                  <td>{r.plate || '--'}</td>
                  <td>{r.driver_name || '--'}</td>
                  <td style={{ fontWeight: '600' }}>{r.line || '--'}</td>
                  <td>{r.date || '--'}</td>
                  <td>{r.park_time ? new Date(r.park_time).toLocaleTimeString() : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
