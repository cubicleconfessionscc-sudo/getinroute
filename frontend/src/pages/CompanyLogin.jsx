import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../components/ui';
import { Building2, Eye, EyeOff } from 'lucide-react';

export default function CompanyLogin() {
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
      } else if (user.role === 'admin') {
        nav('/admin');
      } else if (user.role === 'employee') {
        nav('/app');
      } else if (user.role === 'driver') {
        nav('/driver');
      } else {
        nav('/login');
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(79,70,229,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(124,58,237,.2), transparent), #0f172a' }}>
      <div className="auth-card" style={{ borderTop: '4px solid #4f46e5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}><Building2 size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Company Portal</div>
          </div>
        </div>
        <h1>Company Sign In</h1>
        <p className="sub">Company admins manage employees, routes, vehicles and transportation operations. Only your company's data is ever visible.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email or Employee ID</label>
            <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="admin@yourcompany.com" required autoComplete="username" />
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
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch">New company? <Link to="/register-company" className="auth-link">Request a 10-day trial</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13 }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>All portals</Link>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
          <Link to="/vendor/login" className="auth-link" style={{ fontSize: 13 }}>Vendor login</Link>
        </div>
      </div>
    </div>
  );
}