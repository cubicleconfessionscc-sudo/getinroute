import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { useToast } from '../components/ui';
import { MapPinned, Eye, EyeOff } from 'lucide-react';

// Admin login with an optional operational-location scope. Step 1: enter the
// Admin ID and press Continue -> the server returns ONLY that admin's authorized
// State -> City -> Operational Location options. Step 2: pick a location and sign
// in. The selected location becomes the server-enforced session scope.
export default function AdminLogin({ variant = 'admin' }) {
  const isCompany = variant === 'company';
  const portalName = isCompany ? 'Company Portal' : 'Admin Portal';
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [locs, setLocs] = useState(null); // { states, cities, locations } | null
  const [stateId, setStateId] = useState('');
  const [cityId, setCityId] = useState('');
  const [locId, setLocId] = useState('');

  const loadLocations = async () => {
    if (!form.identifier.trim()) { toast('Enter your Admin ID first', 'err'); return; }
    try {
      const r = await api.post('/api/auth/admin-locations', { identifier: form.identifier.trim() });
      setLocs(r || { states: [], cities: [], locations: [] });
      setStateId(''); setCityId(''); setLocId('');
    } catch (err) { toast(err.message, 'err'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await login(form.identifier.trim(), form.password, locId || undefined);
      if (user.role === 'driver') nav('/driver');
      else if (user.role === 'parent') nav('/parent');
      else if (user.role === 'admin' && user.vertical === 'school') nav('/school');
      else if (user.role === 'admin') nav('/admin');
      else nav('/app');
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  const states = locs ? locs.states : [];
  const cities = locs ? locs.cities.filter((c) => !stateId || String(c.state_id) === String(stateId)) : [];
  const locations = locs ? locs.locations.filter((l) => (!stateId || String(l.state_id) === String(stateId)) && (!cityId || String(l.city_id) === String(cityId))) : [];
  const hasGeo = locs && (states.length || locations.length);

  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ borderTop: '4px solid #7c3aed' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo"><MapPinned size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{portalName}</div>
          </div>
        </div>
        <h1>{isCompany ? 'Company Sign In' : 'Welcome back'}</h1>
        <p className="sub">Sign in with your Admin / Company ID. If your company has operational locations, choose yours and only that location's data will be shown.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Admin ID / Email</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input data-testid="admin-id" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="admin@yourcompany.com" required autoComplete="username" />
              <button type="button" data-testid="continue" className="btn btn-outline" onClick={loadLocations} style={{ whiteSpace: 'nowrap' }}>Continue</button>
            </div>
          </div>

          {hasGeo && (
            <div data-testid="geo-scope" style={{ marginBottom: 14 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>State</label>
                <select data-testid="state" value={stateId} onChange={(e) => { setStateId(e.target.value); setCityId(''); setLocId(''); }}>
                  <option value="">All states</option>
                  {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>City</label>
                <select data-testid="city" value={cityId} onChange={(e) => { setCityId(e.target.value); setLocId(''); }}>
                  <option value="">All cities</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Operational Location</label>
                <select data-testid="location" value={locId} onChange={(e) => setLocId(e.target.value)}>
                  <option value="">All locations (company-wide)</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="field" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input data-testid="password" type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Enter password" required autoComplete="current-password" style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <Link to="/forgot-password" className="auth-link" style={{ fontSize: 13 }}>Forgot password?</Link>
          </div>
          <button data-testid="signin" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch">New company? <Link to="/register-company" className="auth-link">Register here</Link></p>
        <p className="auth-switch" style={{ marginTop: 8 }}>Are you a transport vendor? <Link to="/vendor/login" className="auth-link" style={{ color: '#7c3aed' }}>Vendor Login</Link></p>
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>All sign-in portals</Link>
        </div>
      </div>
    </div>
  );
}
