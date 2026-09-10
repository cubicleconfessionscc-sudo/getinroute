import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import { UserPlus, X, Copy, Check } from 'lucide-react';

export default function ParentAccount() {
  const { user } = useAuth();
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(null);

  const load = () => api.get('/api/parent/me').then(setMe).catch(() => {});
  useEffect(() => { load(); }, []);

  const link = async () => {
    try {
      const r = await api.post('/api/parent/link', { inviteCode: code.trim() });
      toast(r.linked ? `Linked ${r.student.name}` : 'Already linked');
      setCode(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const unlink = async (sid) => {
    try { await api.del(`/api/parent/link/${sid}`); toast('Child unlinked'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const copy = (t) => { navigator.clipboard?.writeText(t); setCopied(t); setTimeout(() => setCopied(null), 1500); };

  return (
    <div>
      <div className="m-card">
        <div className="m-label">My details</div>
        <h2 style={{ fontSize: 17 }}>{user?.name}</h2>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {user?.email} · {user?.phone || 'no phone'}<br />
          {me?.linked_school ? `School: ${me.linked_school.name}` : 'Not linked to any school yet'}
        </div>
      </div>

      <div className="m-card">
        <div className="m-label">Link a child</div>
        <p style={{ fontSize: 13, color: 'var(--slate)', margin: '4px 0 10px' }}>
          Enter the <b>Parent link code</b> the school gave you (it's shown next to your child in the Students list, e.g. <code>SCHL-XXXXXX</code>).
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SCHL-1A2B3C" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={link}><UserPlus size={16} /> Link</button>
        </div>
        {!me?.linked_school && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            First time registering? Parents sign up at the school's invite link — ask your school or use <b>/parent/register</b> on this website.
          </p>
        )}
      </div>

      <div className="m-card">
        <div className="m-label">My children ({me?.children?.length || 0})</div>
        {(me?.children || []).map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 14 }}>{c.name}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {c.class_grade ? `${c.class_grade}${c.section ? ' − ' + c.section : ''}` : ''} · {c.relation || 'guardian'}
                {c.link_code && <> · <button className="btn btn-ghost btn-icon" style={{ padding: 2 }} onClick={() => copy(c.link_code)}>{copied === c.link_code ? <Check size={12} color="#10b981" /> : <Copy size={12} />}</button></>}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => unlink(c.id)}><X size={14} color="#ef4444" /></button>
          </div>
        ))}
        {!(me?.children?.length) && <div className="empty">No children linked yet.</div>}
      </div>
    </div>
  );
}