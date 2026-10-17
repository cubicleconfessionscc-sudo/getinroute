import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';
import { Bell, BellOff, CheckCheck, RefreshCw } from 'lucide-react';

/* Web twin of mobile shared NotificationsScreen — available to every role so the
 * employee and driver shells have the same bell/notifications the APKs have. */
export default function NotificationsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/notifications');
      setItems(Array.isArray(r && r.notifications) ? r.notifications : (Array.isArray(r) ? r : []));
      setUnread(Number((r && r.unread) || 0));
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markAll() {
    try {
      await api.post('/api/notifications/read', {});
      await load();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function markOne(n) {
    if (n.read) return;
    try {
      await api.post('/api/notifications/read', { ids: [Number(n.id)] });
      setItems((prev) => prev.map((x) => (Number(x.id) === Number(n.id) ? { ...x, read: 1 } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) { toast(e.message, 'err'); }
  }

  const fmt = (t) => {
    if (!t) return '';
    const d = new Date(String(t).replace(' ', 'T'));
    return isNaN(d) ? String(t) : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <div className="m-card">
        <div className="row" style={{ alignItems: 'center' }}>
          <Bell size={18} />
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 17 }}>Notifications</b>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{unread} unread</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginRight: 8 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={markAll} disabled={!unread}>
            <CheckCheck size={14} /> Mark all read
          </button>
        </div>
      </div>

      {loading && <div className="empty">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="empty"><BellOff size={16} /> No notifications yet.</div>
      )}

      {items.map((n) => (
        <div className="m-card" key={n.id} onClick={() => markOne(n)}
          style={{ cursor: n.read ? 'default' : 'pointer', opacity: n.read ? 0.7 : 1, borderLeft: n.read ? undefined : '3px solid var(--primary)' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 14 }}>{n.title}</b>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{n.message}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{fmt(n.created_at)}</div>
            </div>
            {!n.read && <span className="badge badge-blue">new</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
