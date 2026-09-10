import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { MapPinned } from 'lucide-react';

export default function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setDone(true);
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
        {done ? (
          <>
            <h1>Check your inbox</h1>
            <p className="sub">If an account exists for <b>{email}</b>, a password reset link has been emailed to you. The link is valid for 1 hour.</p>
            <p className="sub" style={{ marginTop: 8 }}>No email? Check the backend console — reset links are also printed there in demo mode.</p>
            <Link to="/login" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>Back to login</Link>
          </>
        ) : (
          <>
            <h1>Reset password</h1>
            <p className="sub">Enter your registered email and we'll send you a reset link.</p>
            <form onSubmit={submit}>
              <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="auth-switch">Remembered it? <Link to="/login" className="auth-link">Sign in</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
