import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useInterval, Badge, useToast } from '../../components/ui';
import { BellRing, CheckCheck, Trash2, X, Send } from 'lucide-react';

export default function AdminNotifications() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [sent, setSent] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', target: 'all', routeId: '', userId: '' });
  const [sending, setSending] = useState(false);

  const asArr = (r) => (Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : []));
  const load = () => {
    api.get('/api/admin/notifications').then((r) => setList(asArr(r))).catch(() => {});
    api.get('/api/admin/notifications/sent').then((r) => setSent(asArr(r))).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/api/admin/routes').then((r) => setRoutes(asArr(r))).catch(() => {});
    api.get('/api/admin/users?role=employee').then((r) => setEmployees(asArr(r))).catch(() => {});
    api.get('/api/admin/drivers').then((r) => setDrivers(asArr(r))).catch(() => {});
  }, []);
  useInterval(load, 15000);

  const markRead = async () => { await api.post('/api/admin/notifications/read', {}); load(); };
  const del = async (id) => { await api.del(`/api/admin/notifications/${id}`); load(); };
  const clearAll = async () => {
    if (!confirm('Delete all notifications? This cannot be undone.')) return;
    await api.del('/api/admin/notifications'); toast('All notifications cleared'); load();
  };

  const send = async () => {
    if (!form.title.trim()) return toast('Enter a title', 'err');
    setSending(true);
    try {
      const r = await api.post('/api/admin/notifications/send', {
        title: form.title.trim(),
        body: form.body.trim(),
        target: form.target,
        routeId: form.target === 'route' ? Number(form.routeId) : undefined,
        userId: form.target === 'user' ? Number(form.userId) : undefined
      });
      toast(`✓ Notification sent to ${r.sent} recipient(s)`);
      setForm({ title: '', body: '', target: 'all', routeId: '', userId: '' });
      load();
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
    finally { setSending(false); }
  };

  const icon = (t) => ((t || '').includes('Speed') ? 'red' : (t || '').includes('Registration') ? 'amber' : 'blue');

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <div className="page-title">Notifications &amp; Announcements</div>
          <div className="page-sub">Send an important notification to your people and review system events.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={markRead}><CheckCheck size={16} /> Mark all read</button>
          {list.length > 0 && <button className="btn btn-danger" onClick={clearAll}><Trash2 size={16} /> Clear all</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}><Send size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />Compose announcement</div>
        <div className="field" style={{ marginBottom: 10 }}><label>Title</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Office closed on Friday" />
        </div>
        <div className="field" style={{ marginBottom: 10 }}><label>Message</label>
          <textarea rows={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Type the message your people will see…" style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, flex: '1 1 180px' }}><label>Send to</label>
            <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
              <option value="all">All (employees + drivers)</option>
              <option value="employees">All employees</option>
              <option value="drivers">All drivers</option>
              <option value="route">A specific route</option>
              <option value="user">A specific person</option>
            </select>
          </div>
          {form.target === 'route' && (
            <div className="field" style={{ margin: 0, flex: '1 1 200px' }}><label>Route</label>
              <select value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })}>
                <option value="">Select a route…</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          {form.target === 'user' && (
            <div className="field" style={{ margin: 0, flex: '1 1 200px' }}><label>Person</label>
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Select…</option>
                <optgroup label="Employees">{employees.map((e) => <option key={'e' + e.id} value={e.id}>{e.name} · {e.emp_id}</option>)}</optgroup>
                <optgroup label="Drivers">{drivers.map((d) => <option key={'d' + d.id} value={d.id}>{d.name} · {d.emp_id}</option>)}</optgroup>
              </select>
            </div>
          )}
          <button className="btn btn-primary" disabled={sending || !form.title.trim()} onClick={send}>{sending ? 'Sending…' : 'Send notification'}</button>
        </div>
      </div>

      {sent.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ fontSize: 14, marginBottom: 10 }}>Sent announcements</div>
          {sent.map((s) => (
            <div key={s.batch} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{s.title}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.created_at}</div></div>
              <Badge color="green">{s.read_count}/{s.total} read</Badge>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 8 }}>
        <div className="card-title" style={{ fontSize: 14, margin: '8px 12px' }}>Your inbox</div>
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
