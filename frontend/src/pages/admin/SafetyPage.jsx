import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, useInterval } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { Moon, CheckCircle2, ShieldCheck, AlertTriangle, Phone, User, Truck } from 'lucide-react';

const PHASE = { pending: 'Waiting for confirmation', alert: 'PASSENGER ALERT', confirmed: 'Confirmed by passenger', resolved: 'Resolved', allowed: 'Allowed' };
const PHASE_COLOR = { pending: 'amber', alert: 'red', confirmed: 'green', resolved: 'slate', allowed: 'slate' };

export default function SafetyPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState({});

  const load = () => api.get('/api/admin/safety').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 15000);

  useSocketEvent('safety:alert', (a) => {
    toast(`🚨 Night drop alert for ${a?.employee_name || ('passenger #' + a?.employee_id)}`, 'err');
    load();
  });
  useSocketEvent('safety:resolved', () => load());
  useSocketEvent('run:state', () => load());

  const act = async (id, action) => {
    try {
      const r = await api.post(`/api/admin/safety/${id}/resolve`, { action, note: notes[id] || '' });
      toast(action === 'allow' ? 'Acknowledged — next safety drops allowed.' : 'Alert resolved.', 'info');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const pending = rows.filter((r) => r.status === 'pending' || r.status === 'alert');
  const closed = rows.filter((r) => !pending.includes(r));

  return (
    <div>
      <div className="m-label">Night Safety Drop</div>
      <h2>Safety queue</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 600, marginTop: 4 }}>
        Employees dropped home after the configured night window must confirm they reached home.
        Pending and alert items need review.
      </p>

      {pending.length === 0 && (
        <div className="m-card"><div className="empty">No active safety confirmations — all clear.</div></div>
      )}

      {pending.map((a) => (
        <div key={a.id} className="m-card" style={{ border: `1.5px solid ${a.status === 'alert' ? 'var(--red)' : 'var(--amber)'}` }}>
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: a.status === 'alert' ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.14)' }}>
              {a.status === 'alert' ? <AlertTriangle size={20} color="var(--red)" /> : <Moon size={20} color="var(--amber)" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {a.employee_name || 'Employee'} <Badge color={PHASE_COLOR[a.status]}>{PHASE[a.status]}</Badge>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Phone size={12} /> {a.employee_id ? `user #${a.employee_id}` : '—'}</span>
                {a.driver_name && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><User size={12} /> {a.driver_name}</span>}
                {a.vehicle_name && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Truck size={12} /> {a.vehicle_name}</span>}
                {a.trip_id && <span>{a.trip_id}</span>}
              </div>
              {a.lat && a.lng && (
                <a style={{ fontSize: 11, color: 'var(--primary)' }} target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}>View last known location →</a>
              )}
            </div>
            <div className="sp" />
            {a.status !== 'alert' && a.status !== 'pending' ? null : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 260 }}>
                <input
                  value={notes[a.id] || ''}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                  placeholder="Note (optional)" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}
                />
                <button className="btn btn-sm btn-outline" style={{ flex: 1 }} onClick={() => act(a.id, 'allow')}><ShieldCheck size={14} /> Allow next drop</button>
                <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => act(a.id, 'resolve')}><CheckCircle2 size={14} /> Mark reached home</button>
              </div>
            )}
          </div>
          {a.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Note: {a.note}</div>}
        </div>
      ))}

      {closed.length > 0 && (
        <div className="m-card">
          <div className="m-label">Recently resolved</div>
          {closed.slice(0, 15).map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <b style={{ fontSize: 13 }}>{a.employee_name || '—'}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.trip_id || ''} · {a.resolved_at || a.updated_at || ''}</div>
              </div>
              <Badge color={PHASE_COLOR[a.status]}>{PHASE[a.status]}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Badge = ({ color, children }) => (
  <span className={`badge badge-${color}`} style={{ marginLeft: 6 }}>{children}</span>
);