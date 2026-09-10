import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { MapPinned, Building2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

export default function CompanyOnboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({
    companyName: '', domain: '', adminName: '', adminEmail: '', adminPassword: '', phone: ''
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/company/onboard', form);
      setDone(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="auth-bg">
        <div className="auth-card" style={{ textAlign: 'center', borderTop: '4px solid #7c3aed' }}>
          <CheckCircle2 size={52} style={{ color: '#f59e0b', marginBottom: 12 }} />
          <h1>Registration submitted</h1>
          <p className="sub" style={{ marginBottom: 8 }}>
            <strong>{form.companyName}</strong> has been registered.
          </p>
          <p className="sub" style={{ marginBottom: 20 }}>
            Your admin account is <strong>pending owner approval</strong>. You will be able to sign in once the platform owner approves your company.
          </p>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => nav('/login')}>
            Go to Admin Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,.2), transparent), #0f172a' }}>
      <div className="auth-card" style={{ borderTop: '4px solid #7c3aed', maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
            <Building2 size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Company Registration</div>
          </div>
        </div>
        <h1>Register your company</h1>
        <p className="sub">Set up your organisation and admin account. You'll be signed in automatically after registration.</p>

        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field full">
              <label>Company Name</label>
              <input value={form.companyName} onChange={set('companyName')} placeholder="Acme Corp" required />
            </div>
            <div className="field">
              <label>Company Domain</label>
              <input value={form.domain} onChange={set('domain')} placeholder="acme.com" required />
            </div>
            <div className="field">
              <label>Contact Phone</label>
              <input value={form.phone} onChange={set('phone')} placeholder="+91 98450 00000" />
            </div>
            <div className="field full" style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginBottom: 8 }}>Admin Account</div>
            </div>
            <div className="field full">
              <label>Admin Name</label>
              <input value={form.adminName} onChange={set('adminName')} placeholder="Full name" required />
            </div>
            <div className="field full">
              <label>Admin Email</label>
              <input type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="admin@acme.com" required />
            </div>
            <div className="field full">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={form.adminPassword} onChange={set('adminPassword')} placeholder="Min 6 characters" minLength={6} required style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}>
            {busy ? 'Creating company...' : 'Register Company'}
          </button>
        </form>
        <p className="auth-switch">Already have an account? <Link to="/login" className="auth-link">Sign in</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/employee-login" className="auth-link" style={{ fontSize: 13 }}>Employee Login</Link>
        </div>
      </div>
    </div>
  );
}
