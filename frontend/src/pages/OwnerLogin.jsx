import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../components/ui';
import { Shield, Eye, EyeOff } from 'lucide-react';

export default function OwnerLogin() {
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
      if (user.role !== 'admin') {
        toast('Owner access only. Use the correct portal.', 'err');
        return;
      }
      nav('/admin');
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ borderTop: '4px solid #6366f1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo"><Shield size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Platform Owner</div>
          </div>
        </div>
        <h1>Owner Console</h1>
        <p className="sub">Manage companies, branches, and platform settings.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Email</label>
            <input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="owner@getinroute.in" required autoComplete="username" />
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
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>Admin Login</Link>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
          <Link to="/employee-login" className="auth-link" style={{ fontSize: 13 }}>Employee Login</Link>
        </div>
      </div>
    </div>
  );
}
