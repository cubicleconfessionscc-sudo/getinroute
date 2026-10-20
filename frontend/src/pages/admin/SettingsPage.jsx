import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import { Modal } from '../../components/ui';
import { Plus, Pencil, MapPin, Building2, Clock, Bus, Shield, Bell, MapPinned, X, Lock, Key, Copy, Smartphone, AlertTriangle, MessageCircle, ShieldAlert, HelpCircle, Trash2, Search, Palette } from 'lucide-react';
import ThemePicker from '../../components/ThemePicker';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import { MAP_LOCATION_RESULT_KEY } from '../shared/LocationPickerPage';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SettingsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const mapReturnToken = useRef(null);
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [npModal, setNpModal] = useState(false);
  const [npEdit, setNpEdit] = useState(null);
  const [npForm, setNpForm] = useState({ label: '', address: '', lat: null, lng: null, place_id: '', type: 'office', radiusMeters: 1000 });
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [inviteDraft, setInviteDraft] = useState('');
  useEffect(() => {
    setInviteDraft((s && s.account && s.account.inviteCode) || user?.invite_code || '');
  }, [s, user]);

  const saveInviteCode = async () => {
    const code = String(inviteDraft || '').trim().toUpperCase();
    if (code.length < 4) return toast('Invite code must be at least 4 characters.', 'err');
    setSaving(true);
    try {
      const data = await api.patch('/api/admin/settings', { inviteCode: code });
      setS((prev) => ({ ...prev, ...data }));
      toast('✓ Invite code updated successfully', 'ok');
    } catch (e) { toast(e.response?.data?.error || e.message, 'err'); }
    finally { setSaving(false); }
  };

  const DEFAULT_S = {
    company: { name: '', contactPhone: '', supportEmail: '', domain: '', inviteCode: '' },
    vehicleTypes: [], loginTimes: [], logoutTimes: [], weeklyOff: [],
    defaultShiftStart: '09:00', defaultShiftEnd: '18:00',
    cabCutoffTime: '21:30', safeDropWindowMinutes: 30, defaultSpeedLimitKmph: 40,
    maxEmployees: 10000, maxVehicles: 750, noShowWindowMinutes: 15, noShowCountBeforeSuspension: 3,
    nightSafetyEnabled: false, nightSafetyStart: '20:00', nightSafetyEnd: '06:00',
    safetyDropEnabled: false, safetyDropStart: '20:00', safetyDropEnd: '06:00',
    nightHours: { start: '20:00', end: '06:00' }, maxAddressChanges: 2,
    checkInReminderMinutes: 15, nodalRadiusMeters: 1000
  };

  const load = () => {
    setLoading(true);
    const loadSettings = user?.role === 'vendor'
      ? api.get('/api/company/me/nodal-points').then((points) => ({ ...DEFAULT_S, company: { ...DEFAULT_S.company, nodalPoints: Array.isArray(points) ? points : [] } }))
      : api.get('/api/admin/settings');
    loadSettings.then((data) => { setS({ ...DEFAULT_S, ...data }); setLoading(false); }).catch(() => { setS(DEFAULT_S); setLoading(false); });
  };
  useEffect(() => { load(); }, [user?.id, user?.role]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const m = event.data;
      if (!m || m.type !== 'GETINROUTE_MAP_LOCATION' || m.returnToken !== mapReturnToken.current) return;
      setNpForm((prev) => ({ ...prev, address: m.address, lat: m.lat, lng: m.lng, place_id: m.place_id || '' }));
      setNpModal(true);
    };
    window.addEventListener('message', onMessage);
    // Same-tab fallback used by embedded/mobile webviews when window.open is blocked.
    try {
      const raw = sessionStorage.getItem(MAP_LOCATION_RESULT_KEY);
      if (raw) {
        const result = JSON.parse(raw);
        const draft = JSON.parse(sessionStorage.getItem('nodal-map-draft') || '{}');
        if (result && draft.returnToken === result.returnToken) {
          mapReturnToken.current = result.returnToken;
          setNpEdit(draft.npEdit || null);
          setNpForm({ ...draft.npForm, address: result.address, lat: result.lat, lng: result.lng, place_id: result.place_id || '' });
          setNpModal(true);
          sessionStorage.removeItem(MAP_LOCATION_RESULT_KEY);
          sessionStorage.removeItem('nodal-map-draft');
        }
      }
    } catch (e) {}
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const openMapPicker = () => {
    const token = (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mapReturnToken.current = token;
    const q = new URLSearchParams({ returnToken: token, radius: String(npForm.radiusMeters || 1000), returnTo: '/admin/settings', title: 'Select company address on the map' });
    if (npForm.lat != null) q.set('lat', String(npForm.lat));
    if (npForm.lng != null) q.set('lng', String(npForm.lng));
    if (npForm.address) q.set('address', npForm.address);
    if (npForm.place_id) q.set('place_id', npForm.place_id);
    const url = `/admin/map-picker?${q.toString()}`;
    // Web opens a separate tab; embedded webviews fall back to same-tab routing.
    if (window.ReactNativeWebView) {
      sessionStorage.setItem('nodal-map-draft', JSON.stringify({ returnToken: token, npEdit, npForm }));
      window.location.assign(url);
      return;
    }
    const popup = window.open(url, '_blank');
    if (!popup) {
      sessionStorage.setItem('nodal-map-draft', JSON.stringify({ returnToken: token, npEdit, npForm }));
      window.location.assign(url);
    }
  };

  const copyInviteCode = () => {
    const code = s.account?.inviteCode || user?.invite_code || '';
    if (!code) return toast('Invite code not generated yet', 'err');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => toast('Invite code copied', 'ok')).catch(() => fallbackCopy(code));
    } else fallbackCopy(code);
  };
  const fallbackCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Invite code copied', 'ok'); } catch { toast('Could not copy — please select manually', 'err'); }
    document.body.removeChild(ta);
  };

  const update = (patch) => {
    setSaving(true);
    api.patch('/api/admin/settings', patch).then((data) => {
      setS((prev) => ({ ...prev, ...data }));
      toast('Saved', 'ok');
      setSaving(false);
    }).catch((e) => { toast(e.message, 'err'); setSaving(false); });
  };

  if (loading || !s) return <div className="empty">Loading settings...</div>;

  const company = s.company || {};
  const nodalPoints = Array.isArray(company.nodalPoints) ? company.nodalPoints : [];
  const vt = Array.isArray(s.vehicleTypes) ? s.vehicleTypes : [];
  const lt = Array.isArray(s.loginTimes) ? s.loginTimes : [];
  const ot = Array.isArray(s.logoutTimes) ? s.logoutTimes : [];
  const wo = Array.isArray(s.weeklyOff) ? s.weeklyOff : [];

  const saveNodalPoint = async () => {
    if (npForm.lat == null || npForm.lng == null || !npForm.address) return toast('Select an address on Google Maps first.', 'err');
    const payload = { ...npForm, company_location_id: npForm.company_location_id ?? user?.company_location_id ?? null };
    try {
      if (npEdit) {
        await api.put(`/api/company/me/nodal-points/${npEdit}`, payload);
      } else {
        await api.post('/api/company/me/nodal-points', payload);
      }
      toast(npEdit ? 'Nodal point updated' : 'Nodal point added', 'ok');
      setNpModal(false);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  // Vendor portal uses this shared Settings component but only owns its scoped
  // address points (not the company's platform-wide settings).
  if (user?.role === 'vendor') {
    const resetPoint = (np = null) => {
      setNpEdit(np?._id || null);
      setNpForm(np
        ? { label: np.label, address: np.address || '', lat: np.lat, lng: np.lng, place_id: np.place_id || '', type: np.type || 'office', radiusMeters: np.radiusMeters || 1000, company_id: np.company_id, company_location_id: np.company_location_id }
        : { label: '', address: '', lat: null, lng: null, place_id: '', type: 'office', radiusMeters: 1000, company_location_id: user.company_location_id ?? null });
      setNpModal(true);
    };
    return (
      <div className="page settings-page" style={{ maxWidth: 860 }}>
        <div className="page-head"><div><div className="page-title">Vendor Settings</div><div className="page-sub">Manage address points for your authorized vendor locations.</div></div></div>
        <Section icon={<MapPinned size={16} />} title={`Company Address (${nodalPoints.length})`} action={<button className="btn btn-sm btn-primary" onClick={() => resetPoint()}><Plus size={14} /> Add Point</button>}>
          {!nodalPoints.length ? <div style={{ color: 'var(--muted)', padding: 12 }}>No vendor addresses configured.</div> : <div style={{ display: 'grid', gap: 10 }}>
            {nodalPoints.map((np) => <div key={np._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)' }}>
              <MapPin size={16} color="var(--primary)" /><div style={{ flex: 1, minWidth: 0 }}><b>{np.label}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{np.address} · {np.radiusMeters}m</div></div>
              <button className="btn btn-sm btn-ghost" onClick={() => resetPoint(np)}><Pencil size={14} /></button>
              <button className="btn btn-sm btn-ghost" onClick={async () => { try { await api.del(`/api/company/me/nodal-points/${np._id}`); load(); } catch (e) { toast(e.message, 'err'); } }}><Trash2 size={14} /></button>
            </div>)}
          </div>}
        </Section>
        <NodalPointModal open={npModal} onClose={() => setNpModal(false)} npEdit={npEdit} npForm={npForm} setNpForm={setNpForm} onMap={openMapPicker} onSave={saveNodalPoint} />
      </div>
    );
  }

  const changeSlot = (key, list) => (i, field, value) => {
    const next = list.map((t, idx) => (idx === i ? { ...t, [field]: value } : t));
    setS((prev) => ({ ...prev, [key]: next }));
    update({ [key]: next });
  };
  const addSlot = (key, list, def) => () => {
    const next = [...list, def];
    setS((prev) => ({ ...prev, [key]: next }));
    update({ [key]: next });
  };
  const removeSlot = (key, list) => (i) => {
    const next = list.filter((_, idx) => idx !== i);
    setS((prev) => ({ ...prev, [key]: next }));
    update({ [key]: next });
  };
  const toggleWeeklyOff = (d) => {
    const next = wo.includes(d) ? wo.filter((x) => x !== d) : [...wo, d];
    setS((prev) => ({ ...prev, weeklyOff: next }));
    update({ weeklyOff: next });
  };

  return (
    <div className="page settings-page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="page-title">Organization Settings</div>
          <div className="page-sub">Company profile, shifts, cabs, safety policies and mobile app preferences.</div>
        </div>
        <span style={{ fontSize: 13, color: saving ? 'var(--amber)' : 'var(--green)' }}>{saving ? 'Saving...' : 'Changes save automatically'}</span>
      </div>

      <Section icon={<Building2 size={16} />} title="Company Profile">
        <Field label="Company name">
          <input value={company.name || user?.department || ''} readOnly />
          <span className="hint">Company name of your logged-in account.</span>
        </Field>
        <Field label="Company email">
          <input value={user?.email || ''} readOnly />
          <span className="hint">Login email of this company's administrator account.</span>
        </Field>
        <Field label="Contact phone">
          <input defaultValue={company.contactPhone || ''} onBlur={(e) => update({ contactPhone: e.target.value })} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Support email">
          <input type="email" defaultValue={company.supportEmail || ''} onBlur={(e) => update({ supportEmail: e.target.value })} placeholder="support@company.com" />
        </Field>
        <Field label="Email domain">
          <input defaultValue={company.domain || ''} onBlur={(e) => update({ companyDomain: e.target.value.trim().toLowerCase() })} placeholder="company.com" />
          <span className="hint">Employees with this email domain can self-register.</span>
        </Field>
        <Field label="Invite code">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={inviteDraft} onChange={(e) => setInviteDraft(e.target.value.toUpperCase())} placeholder="e.g. ACME-4F7K" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em' }} />
            <button className="btn btn-sm btn-primary" disabled={saving || !inviteDraft.trim() || inviteDraft.trim() === (s.account?.inviteCode || '')} onClick={saveInviteCode}><Key size={14} /> Save</button>
            <button className="btn btn-sm btn-outline" onClick={copyInviteCode}><Copy size={14} /> Copy</button>
          </div>
          <span className="hint">Editable. Share this code with employees/drivers so their registration links to your company.</span>
        </Field>
      </Section>

      <Section icon={<Palette size={16} />} title="Appearance">
        <Field label="Admin portal theme">
          <ThemePicker storageKey="getinroute-theme-admin" />
          <span className="hint">Applies to the Admin portal only — the Vendor portal keeps its own theme. Saved on this device.</span>
        </Field>
      </Section>

      <Section icon={<Clock size={16} />} title="Shift & Schedule Configuration">
        <Field label="Default shift start / end times">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="time" defaultValue={s.defaultShiftStart || '09:00'} onBlur={(e) => update({ defaultShiftStart: e.target.value })} />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>to</span>
            <input type="time" defaultValue={s.defaultShiftEnd || '18:00'} onBlur={(e) => update({ defaultShiftEnd: e.target.value })} />
          </div>
          <span className="hint">Applied when a schedule does not specify office login/logout times.</span>
        </Field>

        <Field label="Weekly off days">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {DAYS.map((d) => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={wo.includes(d)}
                  onChange={() => toggleWeeklyOff(d)}
                />
                {d}
              </label>
            ))}
          </div>
          <span className="hint">Employees won't get cab assignments on these days.</span>
        </Field>

        <Field label="Login time slots (office arrival)">
          <div style={{ display: 'grid', gap: 8 }}>
            {lt.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 32px', gap: 6, alignItems: 'center' }}>
                <input defaultValue={t?.label || ''} onBlur={(e) => changeSlot('loginTimes', lt)(i, 'label', e.target.value)} placeholder="Morning" style={{ fontSize: 15 }} />
                <input type="time" defaultValue={t?.time || ''} onBlur={(e) => changeSlot('loginTimes', lt)(i, 'time', e.target.value)} style={{ fontSize: 15 }} />
                <input type="number" min={0} defaultValue={t?.cutoffMinutes ?? 120} onBlur={(e) => changeSlot('loginTimes', lt)(i, 'cutoffMinutes', Number(e.target.value))} title="Booking cutoff (minutes before)" style={{ fontSize: 15 }} />
                <button className="btn btn-sm btn-ghost" onClick={() => removeSlot('loginTimes', lt)(i)} title="Remove slot"><X size={14} /></button>
              </div>
            ))}
            {!lt.length && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No login slots configured. Add one below.</div>}
            <div>
              <button className="btn btn-sm btn-outline" onClick={addSlot('loginTimes', lt, { label: '', time: '09:00', cutoffMinutes: 120 })}><Plus size={14} /> Add login slot</button>
            </div>
          </div>
          <span className="hint">Each entry: label, HH:MM arrival time, booking cutoff minutes before the slot.</span>
        </Field>

        <Field label="Logout time slots (office departure)">
          <div style={{ display: 'grid', gap: 8 }}>
            {ot.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 32px', gap: 6, alignItems: 'center' }}>
                <input defaultValue={t?.label || ''} onBlur={(e) => changeSlot('logoutTimes', ot)(i, 'label', e.target.value)} placeholder="Evening" style={{ fontSize: 15 }} />
                <input type="time" defaultValue={t?.time || ''} onBlur={(e) => changeSlot('logoutTimes', ot)(i, 'time', e.target.value)} style={{ fontSize: 15 }} />
                <input type="number" min={0} defaultValue={t?.cutoffMinutes ?? 120} onBlur={(e) => changeSlot('logoutTimes', ot)(i, 'cutoffMinutes', Number(e.target.value))} title="Booking cutoff (minutes before)" style={{ fontSize: 15 }} />
                <button className="btn btn-sm btn-ghost" onClick={() => removeSlot('logoutTimes', ot)(i)} title="Remove slot"><X size={14} /></button>
              </div>
            ))}
            {!ot.length && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No logout slots configured. Add one below.</div>}
            <div>
              <button className="btn btn-sm btn-outline" onClick={addSlot('logoutTimes', ot, { label: '', time: '18:00', cutoffMinutes: 120 })}><Plus size={14} /> Add logout slot</button>
            </div>
          </div>
        </Field>
      </Section>

      <Section icon={<Bus size={16} />} title="Cab Configuration">
        <Field label="Cab booking cutoff time">
          <input type="time" defaultValue={s.cabCutoffTime || '21:30'} onBlur={(e) => update({ cabCutoffTime: e.target.value })} />
          <span className="hint">Employees must book before this time for next-day pickup.</span>
        </Field>
        <Field label="Safe drop window (minutes)">
          <input type="number" min={1} max={300} defaultValue={s.safeDropWindowMinutes ?? 30} onBlur={(e) => update({ safeDropWindowMinutes: Number(e.target.value) })} />
          <span className="hint">After drop, drivers have this window to confirm safe arrival.</span>
        </Field>
      </Section>

      <Section icon={<Bus size={16} />} title="Vehicle Types"
        action={
          <button className="btn btn-sm btn-outline" onClick={() => {
            const next = [...vt, { label: '', slug: '', seats: 4, vendor: '' }];
            setS((prev) => ({ ...prev, vehicleTypes: next }));
            update({ vehicleTypes: next });
          }}><Plus size={14} /> Add type</button>
        }>
        <div style={{ display: 'grid', gap: 8 }}>
          {vt.map((v, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 36px', gap: 6, alignItems: 'center' }}>
              <input placeholder="Type name (e.g. Sedan)" value={v.label || ''} onChange={(e) => {
                const next = vt.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x);
                setS((prev) => ({ ...prev, vehicleTypes: next }));
              }} onBlur={() => update({ vehicleTypes: vt })} style={{ fontSize: 15 }} />
              <input placeholder="Vendor name (optional)" value={v.vendor || ''} onChange={(e) => {
                const next = vt.map((x, idx) => idx === i ? { ...x, vendor: e.target.value } : x);
                setS((prev) => ({ ...prev, vehicleTypes: next }));
              }} onBlur={() => update({ vehicleTypes: vt })} style={{ fontSize: 15 }} />
              <input type="number" placeholder="Seats" value={v.seats ?? 4} onChange={(e) => {
                const next = vt.map((x, idx) => idx === i ? { ...x, seats: Number(e.target.value) } : x);
                setS((prev) => ({ ...prev, vehicleTypes: next }));
              }} onBlur={() => update({ vehicleTypes: vt })} style={{ fontSize: 15 }} />
              <button className="btn btn-sm btn-ghost" title="Remove type" onClick={() => {
                const next = vt.filter((_, idx) => idx !== i);
                setS((prev) => ({ ...prev, vehicleTypes: next }));
                update({ vehicleTypes: next });
              }}><Trash2 size={14} color="#ef4444" /></button>
            </div>
          ))}
          {!vt.length && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No vehicle types. Click "Add type".</div>}
        </div>
        <span className="hint">Each row: type name, optional vendor name (e.g. LUPL), and seat count.</span>
      </Section>

      <Section icon={<Shield size={16} />} title="Speed & Vehicle Limits">
        <Field label="Default speed limit (km/h)">
          <input type="number" min={10} max={200} defaultValue={s.defaultSpeedLimitKmph ?? 60} onBlur={(e) => update({ defaultSpeedLimitKmph: Number(e.target.value) })} />
        </Field>
        <Field label="Max employees">
          <input type="number" min={1} defaultValue={s.maxEmployees ?? ''} placeholder="Unlimited" onBlur={(e) => update({ maxEmployees: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Max vehicles">
          <input type="number" min={1} defaultValue={s.maxVehicles ?? ''} placeholder="Unlimited" onBlur={(e) => update({ maxVehicles: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </Section>

      <Section icon={<Shield size={16} />} title="No-Show Policy">
        <Field label="No-show window (minutes after scheduled time)">
          <input type="number" min={5} max={120} defaultValue={s.noShowWindowMinutes ?? 15} onBlur={(e) => update({ noShowWindowMinutes: Number(e.target.value) })} />
          <span className="hint">Employees who don't check in within this window are marked no-show.</span>
        </Field>
        <Field label="Auto-suspend after N no-shows">
          <input type="number" min={1} max={20} defaultValue={s.noShowCountBeforeSuspension ?? 3} onBlur={(e) => update({ noShowCountBeforeSuspension: Number(e.target.value) })} />
        </Field>
      </Section>

      <Section icon={<Shield size={16} />} title="Night Safety">
        <Field label="Enable night safety mode">
          <Toggle checked={s.nightSafetyEnabled ?? false} onChange={(v) => update({ nightSafetyEnabled: v })} />
        </Field>
        {s.nightSafetyEnabled && (
          <>
            <Field label="Night safety start">
              <input type="time" defaultValue={s.nightSafetyStart ?? '20:00'} onBlur={(e) => update({ nightSafetyStart: e.target.value })} />
            </Field>
            <Field label="Night safety end">
              <input type="time" defaultValue={s.nightSafetyEnd ?? '06:00'} onBlur={(e) => update({ nightSafetyEnd: e.target.value })} />
            </Field>
          </>
        )}
      </Section>

      <Section icon={<AlertTriangle size={16} />} title="Night Safety Drop (door-to-door confirmation)">
        <Field label="Enable Night Safety Drop">
          <Toggle checked={s.safetyDropEnabled ?? false} onChange={(v) => update({ safetyDropEnabled: v })} />
        </Field>
        <Field label="Confirmation window start / end (overnight supported)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="time" defaultValue={s.safetyDropStart || '20:00'} onBlur={(e) => update({ safetyDropStart: e.target.value })} />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>to</span>
            <input type="time" defaultValue={s.safetyDropEnd || '06:00'} onBlur={(e) => update({ safetyDropEnd: e.target.value })} />
          </div>
          <span className="hint">
            When an eligible employee is dropped in this window, they must confirm "I reached home" in the app. "Not reached" raises an alert to the Operations team with their live location — no SMS needed for the check-in itself.
          </span>
        </Field>
        <Field label="Eligible employees">
          <a href="/admin/employees" style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)' }}>Open Employees → mark "safety drop eligible" per employee →</a>
        </Field>
      </Section>

      <Section icon={<Bell size={16} />} title="Address & Check-In">
        <Field label="Max address changes per month">
          <input type="number" min={0} max={30} defaultValue={s.maxAddressChanges ?? 2} onBlur={(e) => update({ maxAddressChanges: Number(e.target.value) })} />
          <span className="hint">Set to 0 for unlimited.</span>
        </Field>
        <Field label="Check-in reminder (minutes before)">
          <input type="number" min={5} max={120} defaultValue={s.checkInReminderMinutes ?? 15} onBlur={(e) => update({ checkInReminderMinutes: Number(e.target.value) })} />
          <span className="hint">Push notification sent to drivers before each scheduled pickup/drop.</span>
        </Field>
        <Field label="Default nodal radius (meters)">
          <input type="number" min={100} max={10000} step={50} defaultValue={s.nodalRadiusMeters ?? 1000} onBlur={(e) => update({ nodalRadiusMeters: Number(e.target.value) })} />
        </Field>
      </Section>

      <Section icon={<MapPinned size={16} />} title={`Company Address (${nodalPoints.length})`}
        action={
          <button className="btn btn-sm btn-primary" onClick={() => { setNpEdit(null); setNpForm({ label: '', address: '', lat: null, lng: null, place_id: '', type: 'office', radiusMeters: 1000, company_location_id: user?.company_location_id ?? null }); setNpModal(true); }}>
            <Plus size={14} /> Add Point
          </button>
        }>
        {nodalPoints.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>No company addresses configured. Add your office locations.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {nodalPoints.map((np) => (
              <div key={np._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)' }}>
                <MapPin size={16} color="var(--primary)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{np.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {np.address || `${np.lat}, ${np.lng}`}
                    {np.radiusMeters ? ` · ${np.radiusMeters}m radius` : ''}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  setNpEdit(np._id);
                  setNpForm({ label: np.label, address: np.address || '', lat: np.lat, lng: np.lng, place_id: np.place_id || '', type: np.type || 'office', radiusMeters: np.radiusMeters || 1000, company_id: np.company_id, company_location_id: np.company_location_id });
                  setNpModal(true);
                }}><Pencil size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Key size={16} />} title="Change Password">
        <Field label="Current password">
          <input type="password" value={pwdForm.currentPassword} onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })} placeholder="Enter current password" />
        </Field>
        <Field label="New password">
          <input type="password" value={pwdForm.newPassword} onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })} placeholder="Minimum 6 characters" />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={pwdForm.confirmPassword} onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })} placeholder="Re-enter new password" />
        </Field>
        <button className="btn btn-primary" onClick={async () => {
          if (!pwdForm.currentPassword || !pwdForm.newPassword) return toast('Fill in all fields', 'err');
          if (pwdForm.newPassword.length < 6) return toast('Password must be at least 6 characters', 'err');
          if (pwdForm.newPassword !== pwdForm.confirmPassword) return toast('Passwords do not match', 'err');
          try {
            await api.post('/api/admin/change-password', { currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword });
            toast('Password changed successfully');
            setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
          } catch (e) { toast(e.message, 'err'); }
        }}><Lock size={16} /> Update Password</button>
      </Section>

      {user?.isOwner && (
        <Section icon={<Smartphone size={16} />} title="Mobile App Settings">
          <Field label="SOS / Emergency number">
            <input defaultValue={s.sosNumber || ''} onBlur={(e) => update({ sosNumber: e.target.value })} placeholder="+91 98765 43210" />
            <span className="hint">Displayed in the mobile app SOS button for employees and drivers.</span>
          </Field>
          <Field label="Support WhatsApp number">
            <input defaultValue={s.supportWhatsapp || ''} onBlur={(e) => update({ supportWhatsapp: e.target.value })} placeholder="+91 98765 43210" />
            <span className="hint">Used in mobile app for quick WhatsApp support chat.</span>
          </Field>
          <Field label="App feedback URL">
            <input defaultValue={s.appFeedbackUrl || ''} onBlur={(e) => update({ appFeedbackUrl: e.target.value })} placeholder="https://forms.gle/..." />
            <span className="hint">Google Form or survey link for employee/driver feedback in the app.</span>
          </Field>
          <Field label="Allow address change">
            <Toggle checked={s.allowAddressChange !== false} onChange={(v) => update({ allowAddressChange: v })} />
            <span className="hint">Allow employees to change their home/pickup address in the mobile app.</span>
          </Field>
          <Field label="Allow feedback submission">
            <Toggle checked={s.allowFeedback !== false} onChange={(v) => update({ allowFeedback: v })} />
            <span className="hint">Show the feedback/rating screen after trip completion in the app.</span>
          </Field>
          <Field label="Idle reminder interval (minutes)">
            <input type="number" min={5} max={120} defaultValue={s.idleReminderMinutes ?? 30} onBlur={(e) => update({ idleReminderMinutes: Number(e.target.value) })} />
            <span className="hint">Remind idle drivers to update their status after this interval.</span>
          </Field>
          <Field label="Check-in method">
            <select defaultValue={s.checkInMethod || 'swipe'} onChange={(e) => update({ checkInMethod: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 15 }}>
              <option value="swipe">Swipe</option>
              <option value="otp">OTP</option>
              <option value="both">Both (OTP fallback)</option>
            </select>
            <span className="hint">Method employees use to check in/out in the mobile app.</span>
          </Field>
          <Field label="Enable driver checklist">
            <Toggle checked={s.driverChecklistEnabled !== false} onChange={(v) => update({ driverChecklistEnabled: v })} />
            <span className="hint">Show pre-trip and post-trip checklist for drivers in the app.</span>
          </Field>
          <Field label="Enable SOS button">
            <Toggle checked={s.sosEnabled !== false} onChange={(v) => update({ sosEnabled: v })} />
            <span className="hint">Show SOS/emergency button in the mobile app for employees and drivers.</span>
          </Field>
        </Section>
      )}

      <NodalPointModal open={npModal} onClose={() => setNpModal(false)} npEdit={npEdit} npForm={npForm} setNpForm={setNpForm} onMap={openMapPicker} onSave={saveNodalPoint} />
    </div>
  );
}

function NodalPointModal({ open, onClose, npEdit, npForm, setNpForm, onMap, onSave }) {
  return (
    <Modal open={open} onClose={onClose} title={npEdit ? 'Edit Company Address' : 'Add Company Address'} wide>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Label">
            <input data-testid="address-label" value={npForm.label} onChange={(e) => setNpForm({ ...npForm, label: e.target.value })} placeholder="Head Office / Main Gate" />
          </Field>
          <Field label="Radius (meters)">
            <input data-testid="address-radius" type="number" min={1} max={100000} value={npForm.radiusMeters} onChange={(e) => setNpForm({ ...npForm, radiusMeters: Number(e.target.value) })} />
          </Field>
        </div>
        <button type="button" data-testid="select-google-address" className="btn btn-outline" onClick={onMap}>
          <MapPin size={16} /> Select address on map
        </button>
        <Field label="Address">
          <input data-testid="address-formatted" value={npForm.address || ''} readOnly placeholder="Search, or drop a pin on the map" />
        </Field>
        {npForm.lat != null && npForm.lng != null && (
          <div data-testid="address-view-map" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <ViewOnMapLink lat={npForm.lat} lng={npForm.lng} address={npForm.address} label="View on Google Maps" />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Location is stored as coordinates internally for routing and tracking.
            </span>
          </div>
        )}
        {npForm.place_id ? <div data-testid="address-place-id" style={{ fontSize: 12, color: 'var(--muted)' }}>Place ID: {npForm.place_id}</div> : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button data-testid="save-address-point" className="btn btn-primary" onClick={onSave} disabled={!npForm.label || !npForm.address || npForm.lat == null || npForm.lng == null}>
          <MapPin size={16} /> {npEdit ? 'Save changes' : 'Add point'}
        </button>
      </div>
    </Modal>
  );
}

function Section({ icon, title, children, action }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ color: 'var(--primary)' }}>{icon}</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--slate)' }}>{label}</label>
      {children}
      {React.Children.toArray(children).find((c) => c?.props?.className === 'hint')}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)}
      style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: checked ? 'var(--primary)' : 'var(--surface-3)', position: 'relative', transition: 'background 0.2s' }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </button>
  );
}
