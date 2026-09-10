import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { MapPinned } from 'lucide-react';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const toast = useToast();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return toast('Passwords do not match', 'err');
    if (pw.length < 6) return toast('Password must be at least 6 characters', 'err');
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password: pw });
      toast('Password updated. Sign in with your new password.');
      nav('/login');
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo"><MapPinned size={20} /></div>
          <div style={{ fontWeight: 800, fontSize: 19 }}>GetinRoute</div>
        </div>
        <h1>Choose a new password</h1>
        <p className="sub">Your reset link is valid — enter your new password below.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}><label>New password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
          <div className="field"><label>Confirm password</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <p className="auth-switch"><Link to="/login" className="auth-link">Back to login</Link></p>
      </div>
    </div>
  );
}
