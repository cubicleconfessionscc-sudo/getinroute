import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, useToast } from '../../components/ui';
import { Check, X, Building2, Mail, Phone, User, Clock, CheckCircle, XCircle } from 'lucide-react';

export default function CompanyApprovalsPage() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  const load = () => {
    setLoading(true);
    api.get('/api/admin/pending-companies').then((r) => {
      setList(Array.isArray(r) ? r : []);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const approve = async (u) => {
    try {
      await api.post(`/api/admin/pending-companies/${u.id}/approve`);
      toast(`${u.name} — company approved. They can now login.`);
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const reject = async (u) => {
    try {
      await api.post(`/api/admin/pending-companies/${u.id}/reject`);
      toast(`${u.name} — company rejected`);
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const filtered = list.filter((u) => {
    if (tab === 'pending') return u.approved === 0;
    if (tab === 'approved') return u.approved === 1;
    if (tab === 'rejected') return u.approved === -1;
    return true;
  });

  const pendingCount = list.filter((u) => u.approved === 0).length;
  const approvedCount = list.filter((u) => u.approved === 1).length;
  const rejectedCount = list.filter((u) => u.approved === -1).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Building2 size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Company Approvals</div>
          <div className="page-sub">Review and manage company registrations. Approve to grant access, reject to deny.</div>
        </div>
        {pendingCount > 0 && <Badge color="amber">{pendingCount} pending</Badge>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          ['pending', 'Pending', pendingCount, 'amber'],
          ['approved', 'Approved', approvedCount, 'green'],
          ['rejected', 'Rejected', rejectedCount, 'red']
        ].map(([k, label, count, color]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>
            {label} ({count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card"><div className="empty">Loading...</div></div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          {tab === 'pending' ? (
            <>
              <Building2 size={48} style={{ color: '#4ade80', marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: '#4ade80' }}>All caught up</div>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>No pending company registrations. New companies will appear here after they register.</div>
            </>
          ) : (
            <>
              <Building2 size={48} style={{ color: 'var(--muted)', marginBottom: 12 }} />
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>No {tab} companies.</div>
            </>
          )}
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {filtered.map((u) => (
            <div className="card" key={u.id} style={{ display: 'flex', flexDirection: 'column', borderLeft: `4px solid ${u.approved === 1 ? '#4ade80' : u.approved === -1 ? '#f87171' : '#a78bfa'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div className="avatar" style={{ background: u.approved === 1 ? 'rgba(74,222,128,.15)' : u.approved === -1 ? 'rgba(248,113,113,.15)' : 'rgba(167,139,250,.15)', color: u.approved === 1 ? '#4ade80' : u.approved === -1 ? '#f87171' : '#a78bfa', fontSize: 18 }}>
                  {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 16 }}>{u.name}</b>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Company Admin</div>
                </div>
                <Badge color={u.approved === 1 ? 'green' : u.approved === -1 ? 'red' : 'amber'}>
                  {u.approved === 1 ? 'Approved' : u.approved === -1 ? 'Rejected' : 'Pending'}
                </Badge>
              </div>

              <div style={{ fontSize: 13, color: 'var(--slate)', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Mail size={14} style={{ color: 'var(--muted)' }} />
                  <span>{u.email}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Phone size={14} style={{ color: 'var(--muted)' }} />
                  <span>{u.phone || '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <User size={14} style={{ color: 'var(--muted)' }} />
                  <span>{u.emp_id}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {u.approved === 1 ? <CheckCircle size={14} style={{ color: '#4ade80' }} /> : u.approved === -1 ? <XCircle size={14} style={{ color: '#f87171' }} /> : <Clock size={14} style={{ color: '#f59e0b' }} />}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Registered {u.created_at}</span>
                </div>
              </div>

              {u.approved === 0 && (
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center', fontWeight: 600 }} onClick={() => approve(u)}>
                    <Check size={16} /> Approve Company
                  </button>
                  <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => reject(u)}>
                    <X size={16} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
