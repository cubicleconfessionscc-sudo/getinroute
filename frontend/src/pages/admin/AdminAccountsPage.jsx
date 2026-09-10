import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, useToast } from '../../components/ui';
import { Plus, Trash2, Shield, Mail, Phone, Building2, Power, X, Users, LogIn, Clock } from 'lucide-react';

export default function AdminAccountsPage() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState({ totalAdmins: 0, activeAdmins: 0, loggedInToday: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', companyName: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/admin/admins').then((r) => {
      if (r && typeof r === 'object' && Array.isArray(r.admins)) {
        setList(r.admins);
        setSummary({ totalAdmins: r.totalAdmins || 0, activeAdmins: r.activeAdmins || 0, loggedInToday: r.loggedInToday || 0 });
      } else {
        setList(Array.isArray(r) ? r : []);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/admin/admins', form);
      toast('Admin account created successfully');
      setForm({ name: '', email: '', phone: '', password: '', companyName: '' });
      setShowForm(false);
      load();
    } catch (e) {
      toast(e.message, 'err');
    } finally { setBusy(false); }
  };

  const toggleStatus = async (u) => {
    try {
      const r = await api.put(`/api/admin/admins/${u.id}/toggle-status`);
      toast(`Account ${r.status === 'active' ? 'activated' : 'deactivated'}`);
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const remove = async (u) => {
    if (!confirm(`Delete ${u.name}'s admin account? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/admins/${u.id}`);
      toast('Admin account deleted');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Shield size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Admin Accounts</div>
          <div className="page-sub">Manage all admin accounts and view manager activity per company.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge>{summary.totalAdmins} admins</Badge>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Cancel' : 'Add Admin'}
          </button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="ico ico-indigo"><Shield size={20} /></div>
          <div className="num">{summary.totalAdmins}</div>
          <div className="lbl">Total Admins</div>
        </div>
        <div className="stat">
          <div className="ico ico-green"><Power size={20} /></div>
          <div className="num">{summary.activeAdmins}</div>
          <div className="lbl">Active Admins</div>
        </div>
        <div className="stat">
          <div className="ico ico-violet"><LogIn size={20} /></div>
          <div className="num">{summary.loggedInToday}</div>
          <div className="lbl">Logged In Today</div>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #6366f1' }}>
          <h3 style={{ marginTop: 0 }}>Create New Admin Account</h3>
          <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
            <div className="field">
              <label>Full Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Smith" required />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@company.com" required />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
            </div>
            <div className="field">
              <label>Company Name</label>
              <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Acme Corp" />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimum 6 characters" required minLength={6} />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button className="btn btn-green" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                {busy ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="card"><div className="empty">Loading...</div></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))' }}>
          {list.map((u) => {
            const isOwner = u.isOwner;
            return (
              <div className="card" key={u.id} style={{
                display: 'flex', flexDirection: 'column',
                borderLeft: isOwner ? '4px solid #6366f1' : u.status === 'active' ? '4px solid #4ade80' : '4px solid #94a3b8'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div className="avatar" style={{
                    background: isOwner ? 'rgba(99,102,241,.15)' : 'rgba(74,222,128,.15)',
                    color: isOwner ? '#6366f1' : '#4ade80'
                  }}>
                    {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 15 }}>{u.name}</b>
                    <div style={{ fontSize: 12, color: isOwner ? '#6366f1' : '#4ade80' }}>
                      {isOwner ? 'Platform Owner' : 'Company Admin'}
                    </div>
                  </div>
                  <Badge color={u.status === 'active' ? 'green' : 'slate'}>{u.status}</Badge>
                </div>

                <div style={{ fontSize: 13, color: 'var(--slate)', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={13} style={{ color: 'var(--muted)' }} />
                    <span>{u.email}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={13} style={{ color: 'var(--muted)' }} />
                    <span>{u.phone || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={13} style={{ color: 'var(--muted)' }} />
                    <span>{u.department || '—'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    ID: {u.emp_id}
                  </div>
                  {u.last_login && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                      Last login: {new Date(u.last_login).toLocaleString()} · {u.login_count || 0} logins
                    </div>
                  )}
                </div>

                {!isOwner && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button className="btn btn-sm btn-outline" style={{ flex: 1, justifyContent: 'center' }} onClick={() => toggleStatus(u)}>
                        <Power size={14} /> {u.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="btn btn-sm btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => remove(u)}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>

                    <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 10, fontSize: 13 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Manager Activity ({u.department || 'No department'})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{u.total_managers ?? 0}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>{u.logged_in_today ?? 0}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Today</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: '#7c3aed' }}>{u.logged_in_ever ?? 0}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ever</div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {isOwner && (
                  <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center' }}>
                    Primary owner account — cannot be modified
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
