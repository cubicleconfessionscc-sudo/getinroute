import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function CancellationsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/api/admin/cancel-requests').then((data) => {
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const resolve = (id, action) => {
    api.post(`/api/admin/cancel-requests/${id}`, { action }).then(() => load()).catch(() => {});
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Cancellation Requests</h2>
        <span style={{ marginLeft: 'auto' }}>
          Pending: {rows.filter((r) => r.status === 'pending').length}
        </span>
      </div>
      <p style={{ color: '#777', marginTop: -8, marginBottom: 16 }}>
        Driver-submitted cancellation requests for their assigned runs. Approving cancels the trip and notifies riders; rejecting reverts it.
      </p>

      {loading ? <div className="empty">Loading...</div> : rows.length === 0 ? (
        <div className="empty">No cancellation requests.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Status</th><th>Vehicle</th><th>Driver</th><th>Reason</th><th>Stops/Trips</th><th>Requested</th><th>Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ textTransform: 'capitalize' }}>{r.status}</td>
                  <td>{r.vehicle_name || r.plate || `Vehicle #${r.vehicle_id}`}</td>
                  <td>{r.driver_name || '--'}</td>
                  <td style={{ maxWidth: 240 }}>{r.reason || '--'}</td>
                  <td>{Array.isArray(r.stops) ? r.stops.length : 0}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '--'}</td>
                  <td>
                    {r.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-green btn-sm" onClick={() => resolve(r.id, 'approve')}><CheckCircle2 size={14} /> Approve</button>
                        <button className="btn btn-outline btn-sm" onClick={() => resolve(r.id, 'reject')}><XCircle size={14} /> Reject</button>
                      </div>
                    ) : <span style={{ color: '#888' }}>Resolved</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
