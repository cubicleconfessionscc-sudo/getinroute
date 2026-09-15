import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Modal, Badge, useToast } from '../../components/ui';
import { Search, Pencil, Power, CalendarClock, UserPlus, Lock, Unlock, Building2, ChevronRight, ArrowLeft, Users, Truck, Trash2, RotateCcw } from 'lucide-react';

export default function EmployeesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', email: '', phone: '', department: '', designation: '', password: '' });
  const [vendors, setVendors] = useState([]);
  const isVendor = user?.role === 'vendor';

  useEffect(() => { api.get('/api/admin/vendors').then((r) => setVendors(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const load = () => {
    setLoading(true);
    if (user?.isOwner) {
      api.get('/api/owner/all-users').then((r) => {
        setList(Array.isArray(r?.users) ? r.users : []);
        setCompanies(Array.isArray(r?.companies) ? r.companies : []);
      }).catch(() => {}).finally(() => setLoading(false));
    } else {
      api.get('/api/admin/users', { role: 'employee' }).then((users) => {
        setList(Array.isArray(users) ? users : []);
      }).catch(() => {}).finally(() => setLoading(false));
    }
  };
  useEffect(() => { load(); }, []);

  const openEdit = (u) => {
    setEditing(u._id || u.id);
    setForm({ name: u.name, phone: u.phone, department: u.department, vendor_id: u.vendor_id || '', safety_drop_eligible: u.safety_drop_eligible ? 1 : 0 });
    setModal(true);
  };
  const save = async () => {
    await api.put(`/api/admin/users/${editing}`, form);
    toast('Employee updated'); setModal(false); load();
  };
  const unlock = async (u) => {
    if (!confirm(`Unlock ${u.name}'s account? They will be able to sign in again.`)) return;
    await api.post(`/api/admin/users/${u._id || u.id}/unlock`);
    toast(`${u.name} unlocked`, 'ok'); load();
  };
  const removeUser = async (u) => {
    if (!confirm(`Delete ${u.name}'s account? This cannot be undone.`)) return;
    await api.del(`/api/admin/users/${u._id || u.id}`);
    toast(`${u.name} removed`); load();
  };
  const reactivate = async (u) => {
    if (!confirm(`Reactivate ${u.name}'s account? They will be able to check in/out again.`)) return;
    await api.post(`/api/admin/users/${u._id || u.id}/reactivate`, {});
    toast(`${u.name} reactivated`, 'ok'); load();
  };
  const addEmployee = async () => {
    if (!addForm.name || !addForm.email || !addForm.password) return toast('Name, email and password are required', 'err');
    try {
      const r = await api.post('/api/admin/employees', addForm);
      toast(`Employee added — ID: ${r.emp_id}`, 'ok');
      setAddModal(false);
      setAddForm({ name: '', email: '', phone: '', department: '', designation: '', password: '' });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  if (user?.isOwner) {
    const filteredCompanies = q
      ? companies.filter((c) => (c.company || '').toLowerCase().includes(q.toLowerCase()))
      : companies;

    const companyUsers = selectedCompany
      ? list.filter((u) => u.department === selectedCompany)
      : [];

    if (selectedCompany) {
      return (
        <div className="page">
          <div className="page-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedCompany(null)}>
                <ArrowLeft size={16} /> Back
              </button>
              <div>
                <div className="page-title"><Building2 size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />{selectedCompany}</div>
                <div className="page-sub">{companyUsers.length} users in this company</div>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Role</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>ID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Email</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Phone</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {companyUsers.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: u.role === 'driver' ? 'rgba(74,222,128,.15)' : 'rgba(124,58,237,.15)', color: u.role === 'driver' ? '#4ade80' : '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                          {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px' }}><Badge color={u.role === 'driver' ? 'green' : 'indigo'}>{u.role}</Badge></td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>{u.emp_id}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>{u.email}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>{u.phone || '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}><Badge color={u.approved ? 'green' : 'amber'}>{u.approved ? 'Active' : 'Pending'}</Badge></td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => removeUser(u)} title="Delete user">
                        <Trash2 size={14} color="#ef4444" />
                      </button>
                    </td>
                  </tr>
                ))}
                {companyUsers.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No users in this company.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title"><Building2 size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />All Users by Company</div>
            <div className="page-sub">Click a company to see all drivers and employees.</div>
          </div>
        </div>

        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="ico ico-indigo"><Building2 size={20} /></div>
            <div className="num">{companies.length}</div>
            <div className="lbl">Companies</div>
          </div>
          <div className="stat">
            <div className="ico ico-violet"><Users size={20} /></div>
            <div className="num">{list.length}</div>
            <div className="lbl">Total Users</div>
          </div>
          <div className="stat">
            <div className="ico ico-green"><Truck size={20} /></div>
            <div className="num">{list.filter((u) => u.role === 'driver').length}</div>
            <div className="lbl">Drivers</div>
          </div>
          <div className="stat">
            <div className="ico ico-blue"><Users size={20} /></div>
            <div className="num">{list.filter((u) => u.role === 'employee').length}</div>
            <div className="lbl">Employees</div>
          </div>
        </div>

        <div style={{ position: 'relative', maxWidth: 320, marginBottom: 16 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company name..." style={{ paddingLeft: 36 }} />
        </div>

        {loading ? (
          <div className="card"><div className="empty">Loading...</div></div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {filteredCompanies.map((c) => (
              <button key={c.company} onClick={() => setSelectedCompany(c.company)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: '#fff', border: '1.5px solid var(--line)', borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s, box-shadow .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(79,70,229,.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--grad-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Building2 size={22} color="var(--primary)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{c.company}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {c.drivers} driver{c.drivers !== 1 ? 's' : ''} · {c.employees} employee{c.employees !== 1 ? 's' : ''}
                    {c.pending > 0 && <span style={{ color: '#f59e0b' }}> · {c.pending} pending</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--primary)', fontSize: 13, fontWeight: 600 }}>
                  <span>{c.total}</span>
                  <ChevronRight size={16} />
                </div>
              </button>
            ))}
            {filteredCompanies.length === 0 && (
              <div className="card" style={{ gridColumn: '1 / -1' }}><div className="empty">No companies found.</div></div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Employees</div>
          <div className="page-sub">Manage profiles, access, and schedules. Approve new registrations on the Approvals tab.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / ID / email" style={{ padding: '9px 12px 9px 32px', border: '1.5px solid var(--line)', borderRadius: 10, width: 250 }} />
          </div>
          <button className="btn btn-primary" onClick={() => setAddModal(true)}><UserPlus size={16} /> Add Employee</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u._id || u.id}>
                  <td>
                    <b>{u.name}</b>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                    {u.isLocked && <Badge color="red"><Lock size={10} /> Locked</Badge>}
                  </td>
                  <td><Badge color="indigo">{u.employeeId || u.emp_id || '—'}</Badge></td>
                  <td style={{ fontSize: 13 }}>{u.department || '—'}</td>
                  <td style={{ fontSize: 13, color: 'var(--slate)' }}>{u.phone || '—'}</td>
                  <td>
                    {u.safety_drop_eligible ? <Badge color="indigo">🌙 Night drop</Badge> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td>
                    {u.isLocked ? <Badge color="red">Locked</Badge> :
                     u.status === 'approved' ? <Badge color="green">Active</Badge> :
                     u.status === 'pending' ? <Badge color="amber">Pending</Badge> :
                     u.status === 'suspended' ? <Badge color="red">Suspended</Badge> :
                     <Badge color="slate">{u.status}</Badge>}
                  </td>
                  <td>
                    <div className="actions">
                      {u.isLocked && (
                        <button className="btn btn-sm btn-green" onClick={() => unlock(u)}>
                          <Unlock size={14} /> Unlock
                        </button>
                      )}
                      {(u.status === 'suspended' || u.approved === -1) && (
                        <button className="btn btn-sm btn-green" onClick={() => reactivate(u)}>
                          <RotateCcw size={14} /> Reactivate
                        </button>
                      )}
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)}><Pencil size={14} /></button>
                      <button className="btn btn-sm btn-ghost" title="Remove employee" onClick={() => removeUser(u)}><Trash2 size={14} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="empty">No employees found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Edit employee">
        <div className="form-grid">
          <div className="field"><label>Name</label><input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field full"><label>Department</label><input value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          {!isVendor && <div className="field full"><label>Allotted Vendor</label>
            <select value={form.vendor_id || ''} onChange={(e) => setForm({ ...form, vendor_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Company managed —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Assign this employee to a vendor so the vendor can see their details in their portal.</span>
          </div>}
          <div className="field full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!form.safety_drop_eligible} onChange={(e) => setForm({ ...form, safety_drop_eligible: e.target.checked ? 1 : 0 })} id="sde" />
            <label htmlFor="sde" style={{ fontWeight: 600, fontSize: 13 }}>Night Safety Drop eligible</label>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Requires this employee to confirm reaching home when dropped at night.</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </Modal>

      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add employee">
        <div className="form-grid">
          <div className="field"><label>Name *</label><input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
          <div className="field"><label>Email *</label><input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="employee@company.com" /></div>
          <div className="field"><label>Phone</label><input value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} /></div>
          <div className="field"><label>Password *</label><input value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="Min 6 chars" /></div>
          <div className="field"><label>Department</label><input value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })} /></div>
          <div className="field"><label>Designation</label><input value={addForm.designation} onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })} /></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>The employee is created pre-approved and can log in immediately.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setAddModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={addEmployee}><UserPlus size={16} /> Add Employee</button>
        </div>
      </Modal>
    </div>
  );
}
