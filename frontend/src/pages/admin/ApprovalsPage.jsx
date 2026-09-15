import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Badge, useToast, Modal } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import { Check, X, ClipboardCheck, Building2, Users, Truck, Mail, Phone, Search, Trash2, MapPin, Home } from 'lucide-react';

export default function ApprovalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [addressUpdates, setAddressUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [fixModal, setFixModal] = useState(null);
  const [fixAddr, setFixAddr] = useState(null);
  const [radiusInput, setRadiusInput] = useState({});

  const load = () => {
    setLoading(true);
    if (user?.isOwner) {
      api.get('/api/owner/all-users').then((r) => {
        setAllUsers(Array.isArray(r?.users) ? r.users : []);
      }).catch(() => {});
    } else {
      api.get('/api/admin/approvals').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => {});
      api.get('/api/admin/pending-companies').then((r) => setCompanies(Array.isArray(r) ? r : [])).catch(() => {});
    }
    api.get('/api/admin/address-updates').then((r) => {
      setAddressUpdates(Array.isArray(r) ? r : []);
      const next = {};
      (Array.isArray(r) ? r : []).forEach((a) => { if (radiusInput[a.id] == null) next[a.id] = a.pickup_radius ?? 1000; });
      setRadiusInput((prev) => ({ ...prev, ...next }));
    }).catch(() => {});
    setLoading(false);
  };
  useEffect(() => { load(); }, [user]);

  const pendingCompanies = companies.filter((c) => c.approved === 0);

  const decide = async (u, action) => {
    try {
      if (action === 'reject' && !confirm(`Reject ${u.name}'s registration request? They will not be able to login.`)) return;
      await api.post(`/api/admin/approvals/${u._id || u.id}`, { action });
      toast(action === 'accept' ? `${u.name} approved — access granted` : `${u.name} rejected`);
      load();
    } catch (e) {
      toast(e.message || 'Request failed', 'err');
    }
  };

  const decideCompany = async (u, action) => {
    try {
      if (action === 'reject' && !confirm(`Reject ${u.name}'s company registration?`)) return;
      await api.post(`/api/admin/pending-companies/${u._id || u.id}/${action}`);
      toast(action === 'approve' ? `${u.name} company approved` : `${u.name} company rejected`);
      load();
    } catch (e) {
      toast(e.message || 'Request failed', 'err');
    }
  };

  const removeUser = async (u) => {
    if (!confirm(`Delete ${u.name}'s account? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/users/${u.id}`);
      toast(`${u.name} removed`); load();
    } catch (e) {
      toast(e.message || 'Request failed', 'err');
    }
  };

  const decideAddress = async (au, action) => {
    try {
      if (action === 'approve') {
        await api.post(`/api/admin/address-updates/${au.id}/approve`, { pickupRadius: Number(radiusInput[au.id]) || 1000 });
        toast(`Address approved · pickup radius ${Number(radiusInput[au.id]) || 1000} m`);
      } else {
        await api.post(`/api/admin/address-updates/${au.id}/reject`, fixAddr ? { correctedAddress: fixAddr } : {});
        toast(fixAddr ? 'Rejected — corrected address applied' : 'Address change rejected');
      }
      setFixModal(null); setFixAddr(null);
      load();
    } catch (e) {
      toast(e.message || 'Request failed', 'err');
    }
  };

  if (user?.isOwner) {
    const pendingUsers = allUsers.filter((u) => u.approved === 0);
    const filtered = allUsers.filter((u) => {
      if (search) {
        const q = search.toLowerCase();
        if (!(u.name || '').toLowerCase().includes(q) && !(u.email || '').toLowerCase().includes(q) && !(u.emp_id || '').toLowerCase().includes(q) && !(u.department || '').toLowerCase().includes(q)) return false;
      }
      if (tab === 'drivers') return u.role === 'driver';
      if (tab === 'employees') return u.role === 'employee';
      return true;
    });

    const driverCount = allUsers.filter((u) => u.role === 'driver').length;
    const employeeCount = allUsers.filter((u) => u.role === 'employee').length;

    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title"><Users size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Drivers & Employees</div>
            <div className="page-sub">Complete list of all drivers and employees across all companies.</div>
          </div>
        </div>

        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="ico ico-indigo"><Users size={20} /></div>
            <div className="num">{allUsers.length}</div>
            <div className="lbl">Total Users</div>
          </div>
          <div className="stat">
            <div className="ico ico-green"><Truck size={20} /></div>
            <div className="num">{driverCount}</div>
            <div className="lbl">Drivers</div>
          </div>
          <div className="stat">
            <div className="ico ico-violet"><Users size={20} /></div>
            <div className="num">{employeeCount}</div>
            <div className="lbl">Employees</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, ID..." style={{ paddingLeft: 36 }} />
          </div>
          {[['all', 'All'], ['drivers', 'Drivers'], ['employees', 'Employees']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>{l} ({k === 'all' ? allUsers.length : k === 'drivers' ? driverCount : employeeCount})</button>
          ))}
        </div>

        {loading ? (
          <div className="card"><div className="empty">Loading...</div></div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Role</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Employee ID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Company</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Email</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Phone</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: u.role === 'driver' ? 'rgba(74,222,128,.15)' : 'rgba(124,58,237,.15)', color: u.role === 'driver' ? '#4ade80' : '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                          {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <Badge color={u.role === 'driver' ? 'green' : 'indigo'}>{u.role}</Badge>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>{u.emp_id}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={12} style={{ color: 'var(--muted)' }} />
                        <span>{u.department || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>{u.email}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>{u.phone || '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <Badge color={u.approved ? 'green' : 'amber'}>{u.approved ? 'Approved' : 'Pending'}</Badge>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {u.approved === 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                          <button className="btn btn-sm btn-green" onClick={() => decide(u, 'accept')} title="Approve request"><Check size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => decide(u, 'reject')} title="Reject request"><X size={14} /></button>
                        </div>
                      ) : null}
                      <button className="btn btn-sm btn-ghost" onClick={() => removeUser(u)} title="Delete user">
                        <Trash2 size={14} color="#ef4444" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Approvals</div>
          <div className="page-sub">Employees, drivers, address changes and companies are reviewed here. A corrected address keeps the user active — it is not a rejection.</div>
        </div>
        <Badge color="amber"><ClipboardCheck size={14} /> {list.length + pendingCompanies.length + addressUpdates.filter((a) => a.status === 'pending').length} waiting</Badge>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['employee', `Employees`, list.filter((u) => u.role === 'employee').length],
          ['driver', `Drivers`, list.filter((u) => u.role === 'driver').length],
          ['address', `Addresses`, addressUpdates.filter((a) => a.status === 'pending').length],
          ['company', `Companies`, pendingCompanies.length],
        ].map(([k, label, count]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab(k)}>{label} ({count})</button>
        ))}
      </div>

      {tab === 'address' && addressUpdates.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0ea5e9', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Home size={16} /> Address Change Requests ({addressUpdates.filter((a) => a.status === 'pending').length} pending)
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {addressUpdates.map((au) => (
              <div className="card" key={au.id} style={{ borderLeft: `3px solid ${au.status === 'pending' ? '#f59e0b' : au.status === 'approved' ? '#22c55e' : au.status === 'corrected' ? '#3b82f6' : '#94a3b8'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <b style={{ fontSize: 15 }}>{au.user_name}</b>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{au.user_emp_id}</span>
                  <Badge color={au.status === 'pending' ? 'amber' : au.status === 'approved' || au.status === 'corrected' ? 'green' : 'slate'}>{au.status}</Badge>
                </div>
                <div style={{ fontSize: 13, color: 'var(--slate)' }}>
                  {au.current_address && <div style={{ marginBottom: 4 }}><b>Current:</b> {au.current_address}</div>}
                  <div style={{ background: '#fffbeb', padding: 8, borderRadius: 8, border: '1px dashed #f59e0b', marginBottom: au.reviewed_at ? 4 : 0 }}>
                    <b>Requested:</b> {au.new_address}
                    {au.new_lat && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>({Number(au.new_lat).toFixed(5)}, {Number(au.new_lng).toFixed(5)})</div>}
                  </div>
                  {au.reviewed_at && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Reviewed {au.reviewed_at}</div>}
                </div>
                {au.status === 'pending' && (
                  <div style={{ marginTop: 12 }}>
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Pickup radius (metres) — governs home pickup vs a nearby pickup point</label>
                      <input type="number" min={100} style={{ width: 180 }} value={radiusInput[au.id] ?? au.pickup_radius ?? 1000}
                        onChange={(e) => setRadiusInput({ ...radiusInput, [au.id]: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decideAddress(au, 'approve')}><Check size={15} /> Approve</button>
                      <button className="btn btn-outline" title="Fix address on map" onClick={() => setFixModal(au)}><MapPin size={15} /> Fix</button>
                      <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decideAddress(au, 'reject')}><X size={15} /> Reject</button>
                      <button className="btn btn-ghost" title="Dismiss without changing location" onClick={async () => {
                        if (!confirm(`Dismiss ${au.user_name}'s address request without changing anything?`)) return;
                        try {
                          await api.post(`/api/admin/address-updates/${au.id}/dismiss`);
                          toast('Address request dismissed');
                          load();
                        } catch (e) { toast(e.message || 'Request failed', 'err'); }
                      }}><X size={15} style={{ color: 'var(--muted)' }} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'company' && pendingCompanies.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Building2 size={16} /> Pending Company Registrations ({pendingCompanies.length})
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {pendingCompanies.map((u) => (
              <div className="card" key={u.id} style={{ display: 'flex', flexDirection: 'column', borderLeft: '3px solid #a78bfa' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div className="avatar" style={{ background: 'rgba(167,139,250,.15)', color: '#a78bfa' }}>{(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div>
                    <b style={{ fontSize: 15 }}>{u.name}</b>
                    <div style={{ fontSize: 13, color: '#a78bfa' }}>Company Admin</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--slate)', flex: 1 }}>
                  <div>{u.email}</div>
                  <div>{u.phone || '—'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Registered {u.created_at}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decideCompany(u, 'approve')}><Check size={16} /> Approve</button>
                  <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decideCompany(u, 'reject')}><X size={16} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(tab === 'employee' || tab === 'driver') && list.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>{tab === 'employee' ? 'Employee' : 'Driver'} Registrations ({list.filter((u) => u.role === tab).length})</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {list.filter((u) => u.role === tab).map((u) => (
              <div className="card" key={u._id || u.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div className="avatar" style={{ background: 'var(--grad-soft)', color: 'var(--primary)' }}>{(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div>
                    <b style={{ fontSize: 15 }}>{u.name}</b>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>{u.role} · {u.emp_id}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--slate)', flex: 1 }}>
                  <div>{u.email}</div>
                  <div>{u.phone || '—'}</div>
                  <div style={{ marginTop: 6 }}>{u.department || 'General'} · {u.designation || '—'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Requested {u.created_at}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="btn btn-green" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decide(u, 'accept')}><Check size={16} /> Accept</button>
                  <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => decide(u, 'reject')}><X size={16} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {((tab === 'employee' || tab === 'driver') && list.filter((u) => u.role === tab).length === 0) ||
       (tab === 'company' && pendingCompanies.length === 0) ||
       (tab === 'address' && addressUpdates.length === 0) ? (
        <div className="card"><div className="empty">Nothing waiting in this tab. When new {tab === 'address' ? 'address change requests' : tab === 'company' ? 'company registrations' : `${tab} registrations`} come in, they'll appear here.</div></div>
      ) : null}

      <Modal open={!!fixModal} onClose={() => { setFixModal(null); setFixAddr(null); }} title={`Set correct address for ${fixModal?.user_name || ''}`} wide>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Search and select the correct address from the map dropdown, then save. This replaces the employee's requested address and keeps their access active (status: corrected, not rejected).</p>
        <AddressPicker value={null} onChange={(item) => setFixAddr(item)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => { setFixModal(null); setFixAddr(null); }}>Cancel</button>
          <button className="btn btn-primary" disabled={!fixAddr} onClick={() => decideAddress(fixModal, 'reject')}>Save corrected address</button>
        </div>
      </Modal>
    </div>
  );
}
