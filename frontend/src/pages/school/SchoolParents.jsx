import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge } from '../../components/ui';
import { Users, Phone, Heart, Copy, Check } from 'lucide-react';

export default function SchoolParents() {
  const [list, setList] = useState([]);
  const [school, setSchool] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = () => {
    api.get('/api/school/parents').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/school/me').then((r) => { if (r?.school) setSchool(r.school); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const copy = (t, key) => { navigator.clipboard?.writeText(t); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  const sample = `
1. Give each child's "Parent link code" (Students page) to their parent.
2. The parent opens ${typeof window !== 'undefined' ? window.location.origin : ''}/parent/register, enters their name, email, phone and password, and the child's code.
3. They can then track the bus, confirm drop-offs and raise SOS from the Parent app.
`.trim();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Parents</div>
          <div className="page-sub">Parents register themselves with a child's link code. No manual accounts needed.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-outline" onClick={() => copy(sample, 'how')} style={{ alignItems: 'center' }}>
            {copied === 'how' ? <Check size={14} color="#10b981" /> : <Copy size={14} />} Copy parent guide
          </button>
        </div>
      </div>

      <div className="card" style={{ background: 'linear-gradient(135deg,#fdf2f8,#fff)', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 4 }}>
          <Heart size={20} color="#db2777" />
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#334155' }}>{sample}</div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Name</th><th>Contact</th><th>Joined</th><th>Linked children</th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.email}</div></td>
                  <td>{p.phone ? (<span style={{ fontSize: 13 }}><Phone size={12} /> {p.phone}</span>) : '—'}</td>
                  <td style={{ fontSize: 13 }}>{String(p.created_at || '').slice(0, 10)}</td>
                  <td>
                    {p.children?.length ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(p.children || []).map((c) => (
                          <Badge key={c.student_id} color="violet">{c.student_name}{c.relation ? ` (${c.relation})` : ''}</Badge>
                        ))}
                      </div>
                    ) : <Badge color="slate">No children linked</Badge>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={4}><div className="empty">No parents registered yet. Share the link codes above to get them started.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}