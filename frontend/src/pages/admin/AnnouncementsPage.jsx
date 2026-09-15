import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Modal, Badge, useToast } from '../../components/ui';
import { Plus, Pencil, Trash2, Megaphone } from 'lucide-react';

const AUDIENCES = ['both', 'employee', 'driver', 'school'];
const empty = { id: null, title: '', body: '', audience: 'both', importance: 1, link_url: '', scheduled_at: '' };
const fmt = (iso) => { try { return (iso || '').replace('T', ' ').slice(0, 16); } catch (_) { return iso || ''; } };

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [modal, setModal] = useState(false);

  const load = () => {
    api.get('/api/v3/admin/announcements').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast('Title and message are required', 'err');
    const body = { ...form, importance: Math.min(3, Math.max(1, Number(form.importance) || 1)), scheduled_at: form.scheduled_at || null, link_url: form.link_url || null };
    try {
      if (form.id) { await api.put('/api/v3/admin/announcements', body); toast('Announcement updated'); }
      else { await api.post('/api/v3/admin/announcements', body); toast('Announcement published'); }
      setModal(false); setForm(empty); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const remove = async (a) => {
    if (!confirm(`Delete announcement "${a.title}"? Deleted items no longer reach app users.`)) return;
    try { await api.del(`/api/v3/admin/announcements/${a.id}`); toast('Deleted'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const badgeColor = { employee: 'green', driver: 'violet', both: 'slate', school: 'amber' }[form.audience];
  const audienceColor = { employee: 'green', driver: 'violet', both: 'slate', school: 'amber' };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Announcements</div>
          <div className="page-sub">Broadcast messages to the employee & driver apps. Live announcements appear as banners the moment they are live; the rest are delivered during their scheduled window.</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(empty); setModal(true); }}><Plus size={16} /> New announcement</button>
      </div>

      <div className="table-wrap" style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--line)' }}>
        <table className="tbl">
          <thead><tr><th>Title</th><th>Audience</th><th>Importance</th><th>Live window</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const now = new Date();
              const start = a.schedule_start ? new Date(a.schedule_start) : null;
              const end = a.schedule_end ? new Date(a.schedule_end) : null;
              const live = start ? (start <= now && (!end || end >= now)) : true;
              return (
                <tr key={a.id}>
                  <td><b>{a.title}</b>{a.link_url && <div className="muted" style={{ fontSize: 11 }}>{a.link_url}</div>}</td>
                  <td><Badge color={audienceColor[a.audience] || 'slate'}>{a.audience}</Badge></td>
                  <td>{'!'.repeat(a.importance || 1)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{start ? fmt(a.schedule_start) : 'immediate'} → {end ? fmt(a.schedule_end) : 'no end'}</td>
                  <td><Badge color={live ? 'green' : 'violet'}>{live ? 'LIVE' : 'scheduled'}</Badge></td>
                  <td><div className="actions">
                    <button className="btn btn-sm btn-outline" onClick={() => { setForm({ id: a.id, title: a.title, body: a.body, audience: a.audience, importance: a.importance, link_url: a.link_url || '', scheduled_at: a.schedule_start ? a.schedule_start.slice(0, 19) : '' }); setModal(true); }}><Pencil size={14} /> Edit</button>
                    <button className="btn btn-sm btn-ghost" title="Delete" onClick={() => remove(a)}><Trash2 size={14} color="#ef4444" /></button>
                  </div></td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={6} className="empty">{loading ? 'Loading…' : 'No announcements yet.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit announcement' : 'New announcement'} wide>
        <div className="field" style={{ marginBottom: 12 }}><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Bus timing update for Friday" /></div>
        <div className="field" style={{ marginBottom: 12 }}><label>Message</label><textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write the announcement text…" style={{ width: '100%' }} /></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}><label>Audience</label>
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Badge color={badgeColor}>{AUDIENCES.indexOf(form.audience) >= 0 ? form.audience : 'both'}</Badge>
          </div>
          <div className="field" style={{ minWidth: 120, marginBottom: 0 }}><label>Importance (1-3)</label>
            <input type="number" min={1} max={3} value={form.importance} onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })} />
          </div>
          <div className="field" style={{ minWidth: 200, marginBottom: 0 }}><label>Scheduled start (blank = immediate/live)</label>
            <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 12 }}><label>Deep-link / URL (optional)</label><input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://… or app://…" /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Megaphone size={16} /> {form.id ? 'Save changes' : 'Publish'}</button>
        </div>
      </Modal>
    </div>
  );
}