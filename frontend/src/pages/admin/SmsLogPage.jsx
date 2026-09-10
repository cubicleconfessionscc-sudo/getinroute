import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast, useInterval } from '../../components/ui';
import { MessageSquare, Send, Trash2, X } from 'lucide-react';

export default function SmsLogPage() {
  const { user } = useAuth();
  const isVendor = user?.role === 'vendor';
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => api.get('/api/admin/sms-log').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 8000);

  const sendTest = async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/admin/sms/test', {});
      toast(r.message || 'Test SMS sent');
      load();
    } catch (e) { toast(e.message, 'err'); }
    setLoading(false);
  };

  const delOne = async (id) => {
    await api.del(`/api/admin/sms-log/${id}`);
    load();
  };

  const delAll = async () => {
    if (!confirm('Clear the entire SMS log? This cannot be undone.')) return;
    await api.del('/api/admin/sms-log');
    toast('SMS log cleared');
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">SMS Log</div>
          <div className="page-sub">Every SMS sent by the platform — notifications, alerts and driver broadcasts.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isVendor && <button className="btn btn-primary" onClick={sendTest} disabled={loading}><Send size={16} /> Send test SMS</button>}
          {!isVendor && rows.length > 0 && <button className="btn btn-danger" onClick={delAll}><Trash2 size={16} /> Clear all</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'grid', gap: 0 }}>
          {rows.length === 0 && <div className="empty" style={{ padding: 30 }}>No SMS sent yet.</div>}
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--grad-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MessageSquare size={16} color="#4f46e5" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}><b>{r.to || '—'}</b> <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {r.status} · {r.created_at}</span></div>
                <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>{r.body}</div>
                {r.sid && <div style={{ fontSize: 11, color: 'var(--muted)' }}>SID: {r.sid}</div>}
              </div>
              <span className={`badge ${r.status === 'sent' ? 'badge-green' : 'badge-red'}`}>{r.status}</span>
              {!isVendor && <button className="btn btn-sm btn-ghost" title="Delete entry" onClick={() => delOne(r.id)}><X size={14} color="#ef4444" /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
