import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, useToast } from '../../components/ui';
import { History as HistoryIcon } from 'lucide-react';

export default function EHistory() {
  const [allotments, setAllotments] = useState([]);
  const load = () => api.get('/api/schedules/allotments').then((r) => setAllotments(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!allotments.length) return <div className="empty">Loading…</div>;

  const fmtDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div>
      <div className="m-card">
        <div>
          <div className="m-label" style={{ marginBottom: 2 }}>Your trip history</div>
          <b style={{ fontSize: 18 }}>{allotments.length} trips</b>
        </div>
      </div>

      {allotments.map((a) => {
        const v = a.vehicle || {};
        const d = a.driver || {};
        const ms = a.myStop || {};
        const isCompleted = a.status === 'completed';
        const statusClass = isCompleted ? 'badge-green' : a.status === 'started' || a.status === 'assigned' ? 'badge-blue' : 'badge-slate';

        return (
          <div className="m-card" key={a._id}>
            <div className="row" style={{ alignItems: 'center' }}>
              <div style={{ fontSize: 22 }}>{isCompleted ? '✅' : a.status === 'started' ? '🚌' : '📅'}</div>
              <div style={{ flex: 1 }}>
                <b>{v.vehicleNumber || 'Unassigned vehicle'}</b>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {fmtDate(a.date)} · {d.name || '—'} · {a.slotLabel || 'Shift'}
                </div>
              </div>
              <span className={`badge ${statusClass}`}>{a.status}</span>
            </div>
            {ms && (
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13 }}>
                {ms.pickup?.address && <span className="chip">⬆ {ms.pickup.address}</span>}
                {ms.drop?.address && <span className="chip">⬇ {ms.drop.address}</span>}
              </div>
            )}
            {ms?.checkedInAt && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--slate)' }}>
                Check-in: <b>{new Date(ms.checkedInAt).toLocaleTimeString()}</b>
                {ms.checkedOutAt && <> · Check-out: <b>{new Date(ms.checkedOutAt).toLocaleTimeString()}</b></>}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
        <HistoryIcon size={14} /> {allotments.length} trip{allotments.length !== 1 ? 's' : ''} shown
      </div>
    </div>
  );
}
