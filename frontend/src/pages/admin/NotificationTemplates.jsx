import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge, Modal } from '../../components/ui';
import { Bell, Plus, Send, Eye } from 'lucide-react';

const CHANNELS = ['push', 'sms', 'email', 'whatsapp'];

export default function NotificationTemplates() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [newTpl, setNewTpl] = useState({ name: '', channel: 'push', subject: '', body: '', vars: [] });
  const [varsInput, setVarsInput] = useState('');
  const [sendModal, setSendModal] = useState(null);
  const [sendForm, setSendForm] = useState({ userId: '', channel: 'push', vars: {} });
  const [preview, setPreview] = useState(null);

  const load = () => {
    api.get('/api/v3/notifications/templates').then((r) => setTemplates(Array.isArray(r) ? r : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const addTemplate = async () => {
    try {
      await api.post('/api/v3/notifications/templates', { ...newTpl, vars: varsInput.split(',').map((v) => v.trim()).filter(Boolean) });
      toast('Template created');
      setAddModal(false);
      setNewTpl({ name: '', channel: 'push', subject: '', body: '', vars: [] });
      setVarsInput('');
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const sendNotification = async () => {
    if (!sendModal) return;
    try {
      await api.post('/api/v3/notifications/send', {
        templateName: sendModal.name,
        channel: sendForm.channel || sendModal.channel,
        userId: sendForm.userId ? Number(sendForm.userId) : undefined,
        vars: sendForm.vars
      });
      toast('Notification queued');
      setSendModal(null);
    } catch (e) { toast(e.message, 'err'); }
  };

  const renderPreview = (tpl, vars) => {
    let body = tpl.body || '';
    let subject = tpl.subject || '';
    for (const k of Object.keys(vars)) {
      body = body.split('{{' + k + '}}').join(String(vars[k]));
      subject = subject.split('{{' + k + '}}').join(String(vars[k]));
    }
    return { body, subject };
  };

  if (loading) return <div className="page"><div className="card"><div className="empty">Loading...</div></div></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Bell size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Notification Templates</div>
          <div className="page-sub">Create and manage notification templates for push, SMS, email, and WhatsApp channels.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}><Plus size={14} /> New Template</button>
      </div>

      {templates.length === 0 ? (
        <div className="card"><div className="empty">No notification templates yet. Create one to get started.</div></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))' }}>
          {templates.map((t) => {
            let vars = [];
            try { vars = JSON.parse(t.vars || '[]'); } catch {}
            return (
              <div key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                  <Badge color={CHANNELS.includes(t.channel) ? 'blue' : 'slate'}>{t.channel}</Badge>
                </div>
                {t.subject && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subject: {t.subject}</div>}
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{(t.body || '').slice(0, 200)}{(t.body || '').length > 200 ? '...' : ''}</div>
                {vars.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    Variables: {vars.map((v) => <code key={v} style={{ background: 'var(--bg)', padding: '2px 4px', borderRadius: 4, margin: '0 2px' }}>{'{{' + v + '}}'}</code>)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button className="btn btn-sm btn-outline" onClick={() => setPreview(t)}><Eye size={12} /> Preview</button>
                  <button className="btn btn-sm btn-primary" onClick={() => { setSendForm({ userId: '', channel: t.channel, vars: {} }); setSendModal(t); }}><Send size={12} /> Send</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={addModal} title="New Notification Template" onClose={() => setAddModal(false)} wide>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label><input value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="e.g. trip_assigned" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
            <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channel</label><select value={newTpl.channel} onChange={(e) => setNewTpl({ ...newTpl, channel: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Subject (optional)</label><input value={newTpl.subject} onChange={(e) => setNewTpl({ ...newTpl, subject: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Body</label><textarea value={newTpl.body} onChange={(e) => setNewTpl({ ...newTpl, body: e.target.value })} rows={5} placeholder="Use {{variable}} for dynamic content" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, resize: 'vertical' }} /></div>
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Variables (comma-separated)</label><input value={varsInput} onChange={(e) => setVarsInput(e.target.value)} placeholder="name, route_name, pickup_time" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setAddModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={addTemplate}>Create Template</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!preview} title="Template Preview" onClose={() => setPreview(null)}>
        <div style={{ padding: 16 }}>
          {preview && (
            <div>
              {preview.subject && <div style={{ marginBottom: 8 }}><b>Subject:</b> {preview.subject}</div>}
              <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}>{preview.body || '(empty)'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Channel: {preview.channel}</div>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!sendModal} title={'Send: ' + (sendModal?.name || '')} onClose={() => setSendModal(null)}>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channel</label>
            <select value={sendForm.channel} onChange={(e) => setSendForm({ ...sendForm, channel: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>User ID (optional)</label>
            <input value={sendForm.userId} onChange={(e) => setSendForm({ ...sendForm, userId: e.target.value })} placeholder="Leave empty for broadcast" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setSendModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={sendNotification}><Send size={12} /> Send</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
