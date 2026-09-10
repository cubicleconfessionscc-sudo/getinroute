import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useInterval, Badge, useToast } from '../../components/ui';
import { BellRing, CheckCheck, Trash2, X } from 'lucide-react';

export default function AdminNotifications() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const load = () => api.get('/api/admin/notifications').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 10000);

  const markRead = async () => {
    await api.post('/api/admin/notifications/read', {});
    load();
  };

  const del = async (id) => {
    await api.del(`/api/admin/notifications/${id}`);
    load();
  };

  const clearAll = async () => {
    if (!confirm('Delete all notifications? This cannot be undone.')) return;
    await api.del('/api/admin/notifications');
    toast('All notifications cleared');
    load();
  };

  const icon = (t) => (t.includes('Speed') ? 'red' : t.includes('Registration') ? 'amber' : 'blue');

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="page-title">Notifications</div>
          <div className="page-sub">Speed violations, new registrations and system events.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={markRead}><CheckCheck size={16} /> Mark all read</button>
          {list.length > 0 && <button className="btn btn-danger" onClick={clearAll}><Trash2 size={16} /> Clear all</button>}
        </div>
      </div>
      <div className="card" style={{ padding: 8 }}>
        {list.length === 0 && <div className="empty">No notifications yet.</div>}
        {list.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: 12, padding: '12px 12px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' }}>
            <div className={`ico ${icon(n.title) === 'red' ? 'ico-red' : icon(n.title) === 'amber' ? 'ico-amber' : 'ico-blue'}`} style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BellRing size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ fontSize: 14 }}>{n.title}</b>
                {!n.read && <Badge color="red">New</Badge>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 2 }}>{n.message}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{n.created_at}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => del(n.id)} title="Delete" style={{ flexShrink: 0, marginTop: 4 }}>
              <X size={16} color="#ef4444" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
