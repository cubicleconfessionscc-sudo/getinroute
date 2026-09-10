import React, { useEffect, useState } from 'react';
import { api, ensureArray } from '../../api';
import { Modal, Badge, useToast } from '../../components/ui';
import { Truck, Plus, KeyRound, Power, Trash2, Pencil, MapPin, Clock, Search, Copy, RefreshCw, ShieldOff, Route as RouteIcon, Eye, Lock } from 'lucide-react';

export default function VendorsPage() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', locations: '', routeIds: [] });
  const [creds, setCreds] = useState(null);

  const [showPwdFor, setShowPwdFor] = useState(null);
  const [changePwdFor, setChangePwdFor] = useState(null);
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  const load = () => api.get('/api/admin/vendors')
    .then((r) => setList(ensureArray(r).map((v) => ({
      ...v,
      name: v?.name ?? 'Unnamed vendor',
      status: v?.status ?? 'active',
      login_count: v?.login_count ?? 0,
      assigned_locations: ensureArray(v?.assigned_locations),
      assigned_route_ids: ensureArray(v?.assigned_route_ids).map(Number)
    }))))
    .catch(() => setList([]));

  useEffect(() => {
    load();
    api.get('/api/admin/routes').then((r) => setRoutes(ensureArray(r))).catch(() => {});
  }, []);

  const copyText = (text, label) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(`${label} copied`, 'ok')).catch(() => toast('Could not copy', 'err'));
    } else toast('Clipboard unavailable', 'err');
  };

  const toggleRoute = (target, id) => {
    const cur = ensureArray(target).map(Number);
    return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  };

  const create = async () => {
    if (!form.name) return toast('Vendor name required', 'err');
    try {
      const r = await api.post('/api/admin/vendors', {
        name: form.name, email: form.email || null, phone: form.phone || null,
        password: form.password || null,
        assignedLocations: form.locations ? form.locations.split(',').map((s) => s.trim()).filter(Boolean) : [],
        assignedRouteIds: form.routeIds
      });
      setCreds(r.credentials || null);
      setModal(false);
      setForm({ name: '', email: '', phone: '', password: '', locations: '', routeIds: [] });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/api/admin/vendors/${editModal.id}`, {
        name: editModal.name, email: editModal.email, phone: editModal.phone,
        assignedLocations: ensureArray(editModal.assigned_locations),
        assignedRouteIds: ensureArray(editModal.assigned_route_ids).map(Number)
      });
      toast('Vendor updated');
      setEditModal(null);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const resetPwd = async (v) => {
    if (!confirm(`Reset login password for ${v.name}?`)) return;
    const r = await api.post(`/api/admin/vendors/${v.id}/reset-password`, {});
    setCreds({ email: v.email, password: r.password });
    load();
  };

  const changePwd = async () => {
    if (!changePwdFor) return;
    if (!newPwd || newPwd.length < 6) {
      setPwdErr('Password must be at least 6 characters');
      return;
    }
    if (newPwd !== newPwd2) {
      setPwdErr('Passwords do not match');
      return;
    }
    try {
      const r = await api.post(`/api/admin/vendors/${changePwdFor.id}/reset-password`, { password: newPwd });
      setCreds({ email: changePwdFor.email, password: r.password });
      setChangePwdFor(null); setNewPwd(''); setNewPwd2(''); setPwdErr('');
      load();
    } catch (e) { setPwdErr(e.message); }
  };

  const regenerateCode = async (v) => {
    if (!confirm(`Generate a NEW Vendor ID for ${v.name}? The old ID stops working immediately.`)) return;
    const r = await api.post(`/api/admin/vendors/${v.id}/regenerate-code`, {});
    if (r.vendorCode) copyText(r.vendorCode, 'New Vendor ID');
    load();
  };

  const revokeAccess = async (v) => {
    if (!confirm(`Revoke ${v.name}'s portal login? They will be signed out and unable to sign in until a password is reset.`)) return;
    await api.post(`/api/admin/vendors/${v.id}/revoke-access`, {});
    toast(`${v.name} portal access revoked`);
    load();
  };

  const toggle = async (v) => {
    await api.post(`/api/admin/vendors/${v.id}/toggle-status`, {});
    toast(`${v.name} ${v.status === 'active' ? 'deactivated' : 'activated'}`);
    load();
  };

  const del = async (v) => {
    if (!confirm(`Delete vendor ${v.name}? Their vehicles will be unlinked.`)) return;
    await api.del(`/api/admin/vendors/${v.id}`);
    toast('Vendor deleted');
    load();
  };

  const filtered = q ? list.filter((v) => (v.name || '').toLowerCase().includes(q.toLowerCase())) : list;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Truck size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Vendor Management</div>
          <div className="page-sub">Create vendor logins, assign zones & routes, manage portal access.</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', email: '', phone: '', password: '', locations: '', routeIds: [] }); setModal(true); }}><Plus size={16} /> Add Vendor</button>
      </div>

      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors..." style={{ paddingLeft: 36 }} />
      </div>

      {filtered.length === 0 && <div className="card"><div className="empty">No vendors yet. Click "Add Vendor" to create one.</div></div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {filtered.map((v) => (
          <div className="card" key={v.id} style={{ borderLeft: `3px solid ${v.status === 'active' ? '#22c55e' : '#94a3b8'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div className="avatar" style={{ background: 'rgba(124,58,237,.12)', color: '#7c3aed' }}>{(v.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>{v.name}</b>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{v.email || 'No login yet'}</div>
              </div>
              <Badge color={v.status === 'active' ? 'green' : 'slate'}>{v.status === 'active' ? 'Active' : 'Inactive'}</Badge>
            </div>

            <div style={{ fontSize: 13, color: 'var(--slate)', display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={13} /> Vendor ID:
                <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.05em' }}>{v.vendor_code || '—'}</span>
                {v.vendor_code && (
                  <button className="btn btn-sm btn-ghost" title="Copy Vendor ID" onClick={() => copyText(v.vendor_code, 'Vendor ID')}><Copy size={13} /></button>
                )}
              </div>
              <div><b>Login Access:</b> {v.has_login ? <Badge color="green">Set up</Badge> : <Badge color="amber">Not created / revoked</Badge>}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={13} /> Last login: {v.last_login || 'Never'} ({v.login_count} total)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <MapPin size={13} /> Zones:
                {Array.isArray(v.assigned_locations) && v.assigned_locations.length ? v.assigned_locations.map((l, i) => <Badge key={i} color="indigo">{l}</Badge>) : <span style={{ color: 'var(--muted)' }}>All</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <RouteIcon size={13} /> Routes:
                {Array.isArray(v.assigned_route_ids) && v.assigned_route_ids.length
                  ? v.assigned_route_ids.map((id) => <Badge key={id} color="blue">{(routes.find((r) => Number(r.id) === Number(id)) || {}).name || `#${id}`}</Badge>)
                  : <span style={{ color: 'var(--muted)' }}>None</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              {!v.has_login && <button className="btn btn-sm btn-primary" onClick={() => { setForm({ name: v.name, email: '', phone: v.phone || '', password: '', locations: (Array.isArray(v.assigned_locations) ? v.assigned_locations : []).join(', '), routeIds: Array.isArray(v.assigned_route_ids) ? [...v.assigned_route_ids] : [] }); setModal(true); }}><KeyRound size={13} /> Create Login</button>}
              {v.has_login && <button className="btn btn-sm btn-ghost" onClick={() => setShowPwdFor(v)} title="Password is encrypted and cannot be revealed"><Eye size={13} /> Show Password</button>}
              {v.has_login && <button className="btn btn-sm btn-outline" onClick={() => setChangePwdFor(v)}><KeyRound size={13} /> Change Password</button>}
              {v.has_login && <button className="btn btn-sm btn-outline" onClick={() => resetPwd(v)}><KeyRound size={13} /> Reset Password</button>}
              {v.has_login && <button className="btn btn-sm btn-danger" onClick={() => revokeAccess(v)}><ShieldOff size={13} /> Revoke Access</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => regenerateCode(v)} title="Issue a new Vendor ID"><RefreshCw size={13} /> New ID</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditModal({ ...v })}><Pencil size={13} /> Edit</button>
              <button className={`btn btn-sm ${v.status === 'active' ? 'btn-danger' : 'btn-green'}`} onClick={() => toggle(v)}>
                <Power size={13} /> {v.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => del(v)}><Trash2 size={13} color="#ef4444" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setCreds(null); }} title="Add vendor">
        <div className="form-grid">
          <div className="field full"><label>Vendor name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LUPL Transport" /></div>
          <div className="field"><label>Email (login ID)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="vendor@company.com" /></div>
          <div className="field"><label>Password</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank = no login yet" /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field full"><label>Allotted zones (comma separated)</label><input value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} placeholder="Whitefield, Marathahalli, KR Puram" /></div>
          <div className="field full">
            <label>Assigned routes (visible in their portal)</label>
            <div style={{ maxHeight: 120, overflowY: 'auto', border: '1.5px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
              {routes.map((r) => (
                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.routeIds.includes(Number(r.id))}
                    onChange={() => setForm((f) => ({ ...f, routeIds: toggleRoute(f.routeIds, Number(r.id)) }))} />
                  {r.name}
                </label>
              ))}
              {!routes.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No routes created yet.</span>}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>A unique Vendor ID is generated automatically — vendors can sign in with either this ID or email plus the password.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={create}>Create Vendor</button>
        </div>
      </Modal>

      <Modal open={!!editModal} onClose={() => setEditModal(null)} title={`Edit ${editModal?.name || ''}`}>
        {editModal && (
          <>
            <div className="form-grid">
              <div className="field full"><label>Name</label><input value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} /></div>
              <div className="field"><label>Email</label><input value={editModal.email || ''} onChange={(e) => setEditModal({ ...editModal, email: e.target.value })} /></div>
              <div className="field"><label>Phone</label><input value={editModal.phone || ''} onChange={(e) => setEditModal({ ...editModal, phone: e.target.value })} /></div>
              <div className="field full"><label>Allotted zones (comma separated)</label><input aria-label="Allotted zones" value={(Array.isArray(editModal.assigned_locations) ? editModal.assigned_locations : []).join(', ')} onChange={(e) => setEditModal({ ...editModal, assigned_locations: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></div>
              <div className="field full">
                <label>Assigned routes</label>
                <div style={{ maxHeight: 120, overflowY: 'auto', border: '1.5px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
                  {routes.map((r) => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={ensureArray(editModal.assigned_route_ids).map(Number).includes(Number(r.id))}
                        onChange={() => setEditModal((em) => ({ ...em, assigned_route_ids: toggleRoute(em.assigned_route_ids, Number(r.id)) }))} />
                      {r.name}
                    </label>
                  ))}
                  {!routes.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No routes created yet.</span>}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!creds} onClose={() => setCreds(null)} title="Vendor login credentials">
        {creds && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 12 }}>Share these credentials with the vendor. The password will not be shown again.</p>
            <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, padding: 14, fontFamily: 'monospace' }}>
              {creds.vendorCode && <div><b>Vendor ID:</b> {creds.vendorCode}</div>}
              <div><b>Email:</b> {creds.email}</div>
              <div><b>Password:</b> {creds.password}</div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => copyText(`Vendor ID: ${creds.vendorCode || ''}\nEmail: ${creds.email}\nPassword: ${creds.password}`, 'Credentials')}>Copy</button>
          </div>
        )}
      </Modal>

      <Modal open={!!showPwdFor} onClose={() => setShowPwdFor(null)} title={`Password — ${showPwdFor?.name || ''}`}>
        {showPwdFor && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'rgba(100,116,139,.12)', marginBottom: 12 }}>
              <Lock size={22} color="#64748b" />
            </div>
            <p style={{ marginBottom: 12 }}>The password is stored <b>encrypted</b> and cannot be revealed, even to you as admin.</p>
            <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 10, padding: 14, fontFamily: 'monospace', color: 'var(--muted)' }}>••••••••</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
              To give this vendor a new password, use <b>Change Password</b> or <b>Reset Password</b> on their card.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setShowPwdFor(null)}>Got it</button>
          </div>
        )}
      </Modal>

      <Modal open={!!changePwdFor} onClose={() => { setChangePwdFor(null); setNewPwd(''); setNewPwd2(''); setPwdErr(''); }} title={`Change password — ${changePwdFor?.name || ''}`}>
        {changePwdFor && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Set a specific new password for <b>{changePwdFor.email || changePwdFor.name}</b>. The vendor will use this on their next sign-in immediately.</p>
            {pwdErr && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{pwdErr}</div>}
            <div className="field"><label>New password</label><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" /></div>
            <div className="field"><label>Confirm new password</label><input type="password" value={newPwd2} onChange={(e) => setNewPwd2(e.target.value)} placeholder="Repeat the password" autoComplete="new-password" /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => { setChangePwdFor(null); setNewPwd(''); setNewPwd2(''); setPwdErr(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={changePwd}>Set Password</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
