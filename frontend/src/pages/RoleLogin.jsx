import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../components/ui';
import { CarFront, Users, Eye, EyeOff, ArrowLeft } from 'lucide-react';

export default function RoleLogin({ role }) {
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const cfg = role === 'parent'
    ? { title: 'Parent Sign In', sub: 'Use the email and password your school provided to track your child\'s rides.', home: '/parent', accent: '#22d3ee', icon: <Users size={20} />, register: { to: '/parent/register', text: 'New parent? Register here' } }
    : { title: 'Driver Sign In', sub: 'Use the email and driver ID provided by your operator.', home: '/driver', accent: '#22d3ee', icon: <CarFront size={20} />, register: null };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await login(form.identifier.trim(), form.password);
      if (user.role !== role) {
        toast(role === 'driver' ? 'This account is not a driver. Use the matching portal.' : 'This account is not a parent. Use the matching portal.', 'err');
        return;
      }
      nav(cfg.home);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ borderTop: `4px solid ${cfg.accent}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo" style={{ background: 'linear-gradient(135deg, #22d3ee, #0ea5e9)' }}>{cfg.icon}</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{role === 'parent' ? 'Parent App · Schools' : 'Driver App'}</div>
          </div>
        </div>
        <h1>{cfg.title}</h1>
        <p className="sub">{cfg.sub}</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email or ID</label>
            <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder={role === 'driver' ? 'e.g. DRV-102 or you@company.com' : 'you@example.com'} required autoComplete="username" />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Enter password" required autoComplete="current-password" style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
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
        {cfg.register && <p className="auth-switch">{cfg.register.text.split('?')[0]}? <Link to={cfg.register.to} className="auth-link">{cfg.register.text.split('?')[1]}</Link></p>}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Link to="/login" style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={14} /> Choose a different portal</Link>
        </div>
      </div>
    </div>
  );
}