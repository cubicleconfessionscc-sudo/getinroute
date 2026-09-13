import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../components/ui';
import { School, Eye, EyeOff } from 'lucide-react';

export default function SchoolLogin() {
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await login(form.identifier.trim(), form.password);
      if (user.role === 'admin' && user.vertical === 'school') {
        nav('/school');
      } else if (user.role === 'parent') {
        nav('/parent');
      } else if (user.role === 'admin') {
        toast('This account is not a school account. Use the Company portal instead.', 'err');
      } else if (user.role === 'employee') {
        nav('/app');
      } else if (user.role === 'driver') {
        nav('/driver');
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(13,148,136,.28), transparent), radial-gradient(900px 500px at 110% 110%, rgba(16,185,129,.2), transparent), #0f172a' }}>
      <div className="auth-card" style={{ borderTop: '4px solid #0d9488' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo" style={{ background: 'linear-gradient(135deg, #0d9488, #10b981)' }}><School size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>School Portal</div>
          </div>
        </div>
        <h1>School Sign In</h1>
        <p className="sub">School admins manage students, buses, routes, drivers and geofenced zones. Only your school's data is ever visible.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email or ID</label>
            <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="admin@school.edu" required autoComplete="username" />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Enter password" required autoComplete="current-password" style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <Link to="/forgot-password" className="auth-link" style={{ fontSize: 13 }}>Forgot password?</Link>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #0d9488, #059669)', boxShadow: '0 6px 16px -6px rgba(13,148,136,.55)' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch">New school? <Link to="/register-company" className="auth-link">Request access</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13 }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>All portals</Link>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
          <Link to="/parent/register" className="auth-link" style={{ fontSize: 13 }}>Parent sign-up</Link>
        </div>
      </div>
    </div>
  );
}