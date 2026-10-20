import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { Modal } from '../../components/ui';
import { Plus, MapPin, Key, RefreshCw, X, Copy, Check, Building2, MapPinned, Trash2 } from 'lucide-react';
import AddressPicker from '../../components/AddressPicker';
import ViewOnMapLink from '../../components/ViewOnMapLink';

// Admin Operations page (Part 3.1 / Part 3.2 / Part 3.3 / Part 4.3).
//
// Three sections, each calling the new backend endpoints:
//   1. Locations & Addresses  -> /api/admin/locations, /api/admin/addresses
//   2. Location Codes         -> /api/admin/location-codes
//   3. Pending location changes -> /api/admin/location-change-requests
export default function AdminOpsPage() {
  const toast = useToast();

  // ---- Locations & addresses ----
  const [locData, setLocData] = useState({ states: [], cities: [], locations: [], addresses: [] });
  const [addrModal, setAddrModal] = useState(false);
  const [addrEdit, setAddrEdit] = useState(null);
  const [addrForm, setAddrForm] = useState({ company_location_id: '', label: '', address: '', lat: null, lng: null });
  async function loadLocations() {
    try {
      const [locs, addrs] = await Promise.all([
        api.get('/api/admin/locations'),
        api.get('/api/admin/addresses')
      ]);
      setLocData({ ...locs, addresses: addrs });
    } catch (e) { toast(e.message, 'err'); }
  }
  useEffect(() => { loadLocations(); }, []);

  async function saveAddress() {
    try {
      if (addrEdit) await api.put('/api/admin/addresses/' + addrEdit.id, addrForm);
      else await api.post('/api/admin/addresses', addrForm);
      setAddrModal(false);
      setAddrEdit(null);
      setAddrForm({ company_location_id: '', label: '', address: '', lat: null, lng: null });
      loadLocations();
    } catch (e) { toast(e.message, 'err'); }
  }
  function openAdd() {
    setAddrEdit(null);
    setAddrForm({ company_location_id: locData.locations[0] ? locData.locations[0].id : '', label: '', address: '', lat: null, lng: null });
    setAddrModal(true);
  }
  function openEdit(a) {
    setAddrEdit(a);
    setAddrForm({ company_location_id: a.company_location_id, label: a.label, address: a.address || '', lat: a.lat, lng: a.lng });
    setAddrModal(true);
  }
  async function removeAddress(a) {
    if (!window.confirm('Remove address "' + a.label + '"?')) return;
    try { await api.del('/api/admin/addresses/' + a.id); loadLocations(); } catch (e) { toast(e.message, 'err'); }
  }

  // ---- Location codes ----
  const [codes, setCodes] = useState([]);
  const [codeModal, setCodeModal] = useState(false);
  const [codeForm, setCodeForm] = useState({ company_location_id: '', notes: '' });
  async function loadCodes() {
    try { setCodes(await api.get('/api/admin/location-codes')); } catch (e) { toast(e.message, 'err'); }
  }
  useEffect(() => { loadCodes(); }, []);

  async function issueCode() {
    try { await api.post('/api/admin/location-codes', codeForm); setCodeModal(false); setCodeForm({ company_location_id: '', notes: '' }); loadCodes(); } catch (e) { toast(e.message, 'err'); }
  }
  async function revokeCode(c) {
    if (!window.confirm('Revoke the active code for this location? The location admin will be unable to sign in until a new code is issued.')) return;
    try { await api.post('/api/admin/location-codes/' + c.id + '/revoke'); loadCodes(); } catch (e) { toast(e.message, 'err'); }
  }

  // ---- Pending location-change requests ----
  const [changeReqs, setChangeReqs] = useState([]);
  const [reasonDraft, setReasonDraft] = useState({});
  async function loadChangeReqs() {
    try { setChangeReqs(await api.get('/api/admin/location-change-requests?status=pending')); } catch (e) { toast(e.message, 'err'); }
  }
  useEffect(() => { loadChangeReqs(); }, []);
  async function approve(r) {
    try { await api.post('/api/admin/location-change-requests/' + r.id + '/approve', { reason: reasonDraft[r.id] || '' }); loadChangeReqs(); } catch (e) { toast(e.message, 'err'); }
  }
  async function reject(r) {
    try { await api.post('/api/admin/location-change-requests/' + r.id + '/reject', { reason: reasonDraft[r.id] || '' }); loadChangeReqs(); } catch (e) { toast(e.message, 'err'); }
  }
  async function expireAll() {
    try { const r = await api.post('/api/admin/location-change-requests/expire', {}); toast(`Expired ${r.expired} requests`); loadChangeReqs(); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h2 style={{ margin: 0 }}>Company Operations</h2>

      {/* ---- Locations & Addresses ---- */}
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>Locations &amp; Addresses</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {locData.states.length} states · {locData.cities.length} cities · {locData.locations.length} locations · {locData.addresses.length} addresses
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={14} /> Add address</button>
        </div>
        {locData.locations.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>No locations yet. Add a company through the registration form to seed states, cities and locations.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {locData.locations.map((l) => {
              const city = locData.cities.find((c) => c.id === l.city_id);
              const state = locData.states.find((s) => s.id === l.state_id);
              const addrs = locData.addresses.filter((a) => a.company_location_id === l.id);
              return (
                <div key={l.id} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={16} color="var(--primary)" />
                    <div style={{ flex: 1, fontWeight: 700 }}>{l.name}</div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{state ? state.name : '?'} / {city ? city.name : '?'}</span>
                  </div>
                  {addrs.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>No addresses pinned yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                      {addrs.map((a) => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#fff', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}>
                          <MapPin size={12} color="var(--primary)" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{a.label}</div>
                            <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.address || (a.lat != null ? 'Location saved' : '—')}</span>
                              {a.lat != null && <ViewOnMapLink lat={a.lat} lng={a.lng} address={a.address} label="Map" />}
                            </div>
                          </div>
                          <button className="btn btn-sm btn-ghost" onClick={() => openEdit(a)}><Pencil size={12} /></button>
                          <button className="btn btn-sm btn-ghost" onClick={() => removeAddress(a)}><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Location Codes ---- */}
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>Location codes</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Each location has at most one ACTIVE code. The code is the credential a location-scoped admin enters at login.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" disabled={locData.locations.length === 0} onClick={() => { setCodeForm({ company_location_id: locData.locations[0] ? locData.locations[0].id : '', notes: '' }); setCodeModal(true); }}>
            <Plus size={14} /> Issue / Regenerate
          </button>
        </div>
        {codes.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>No codes issued yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {codes.map((c) => (
              <CodeRow key={c.id} c={c} onRevoke={() => revokeCode(c)} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Pending location-change requests ---- */}
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17 }}>Pending location changes</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Approve to move the employee to the new location for future bookings. History stays with the old location.
            </p>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={expireAll}><RefreshCw size={14} /> Run expiry sweep</button>
        </div>
        {changeReqs.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>No pending requests.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {changeReqs.map((r) => (
              <div key={r.id} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{r.employee ? r.employee.name : 'Unknown employee'} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({r.employee ? r.employee.emp_id : '?'})</span></div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      From {r.from ? `${r.from.name} (${r.from.city}, ${r.from.state})` : '—'} → To {r.to ? `${r.to.name} (${r.to.city}, ${r.to.state})` : '—'}
                    </div>
                    {r.reason ? <div style={{ fontSize: 12, marginTop: 4 }}>Reason: {r.reason}</div> : null}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Requested {r.requested_at}{r.expires_at ? ` · expires ${r.expires_at}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input placeholder="Reason (optional, sent to employee)" value={reasonDraft[r.id] || ''} onChange={(e) => setReasonDraft({ ...reasonDraft, [r.id]: e.target.value })} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => approve(r)}>Approve</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => reject(r)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Address modal */}
      <Modal open={addrModal} onClose={() => setAddrModal(false)} title={addrEdit ? 'Edit address' : 'Add address'}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Location</label>
            <select value={addrForm.company_location_id} onChange={(e) => setAddrForm({ ...addrForm, company_location_id: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 }}>
              {locData.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Label</label>
            <input value={addrForm.label} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} placeholder="e.g. Bangalore Location 1" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Address (Google Maps picker)</label>
            <AddressPicker value={addrForm.lat != null ? { address: addrForm.address, lat: addrForm.lat, lng: addrForm.lng } : null} onChange={(v) => setAddrForm({ ...addrForm, address: v.address, lat: v.lat, lng: v.lng })} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setAddrModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!addrForm.company_location_id || !addrForm.label || addrForm.lat == null} onClick={saveAddress}>Save</button>
          </div>
        </div>
      </Modal>

      {/* Code modal */}
      <Modal open={codeModal} onClose={() => setCodeModal(false)} title="Issue / regenerate location code">
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Location</label>
            <select value={codeForm.company_location_id} onChange={(e) => setCodeForm({ ...codeForm, company_location_id: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 }}>
              {locData.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>If a code is already active for this location it will be revoked and a new one issued.</p>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Notes (optional)</label>
            <input value={codeForm.notes} onChange={(e) => setCodeForm({ ...codeForm, notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setCodeModal(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!codeForm.company_location_id} onClick={issueCode}>Issue</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CodeRow({ c, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: '#fff' }}>
      <Key size={14} color={c.status === 'active' ? '#10b981' : '#94a3b8'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{c.location_name} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>({c.city_name}, {c.state_name})</span></div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', color: c.status === 'active' ? '#10b981' : '#94a3b8' }}>{c.code}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>issued {c.issued_at}{c.revoked_at ? ` · revoked ${c.revoked_at}` : ''}</div>
      </div>
      <span style={{ fontSize: 11, color: c.status === 'active' ? '#10b981' : '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{c.status}</span>
      <button className="btn btn-sm btn-ghost" onClick={copy}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
      {c.status === 'active' && <button className="btn btn-sm btn-ghost" onClick={onRevoke}>Revoke</button>}
    </div>
  );
}
