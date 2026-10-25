import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';
import { Truck } from 'lucide-react';

export default function VendorLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post('/api/vendor/login', { email, password });
      setToken(r.token);
      localStorage.setItem('gir_user', JSON.stringify(r.user));
      window.location.href = '/vendor-portal';
    } catch (ex) {
      setErr(ex?.message || 'Invalid credentials');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 400, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(37,99,235,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Truck size={20} color="var(--primary)" />
          </div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Vendor Portal</h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Sign in with the credentials issued by your transport admin.</p>
        {err && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Email or Vendor ID</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vendor@company.com or VND-A1B2C3" style={{ width: '100%', marginBottom: 14 }} autoComplete="username" />
        <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', marginBottom: 18 }} autoComplete="current-password" />
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in...' : 'Sign In'}</button>
        <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 14 }}>
          Vendors cannot self-register. Contact your company admin for access.
        </p>
        <p style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>
          <a href="/login" style={{ color: 'var(--primary)', fontWeight: 600 }}>All sign-in portals</a>
        </p>
      </form>
    </div>
  );
}
