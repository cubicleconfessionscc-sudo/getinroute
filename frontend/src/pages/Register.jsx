import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { MapPinned, Briefcase, Truck, Building2 } from 'lucide-react';

export default function Register() {
  const toast = useToast();
  const [role, setRole] = useState('employee');
  const [form, setForm] = useState({ emp_id: '', email: '', password: '', name: '', phone: '', department: '', designation: '', inviteCode: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/register', { ...form, role });
      setDone(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="auth-bg">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 46, marginBottom: 10 }}>📨</div>
          <h1>Registration submitted</h1>
          <p className="sub" style={{ marginBottom: 8 }}>Your request has been sent to the admin team for approval.</p>
          <p className="sub">You'll be able to sign in as soon as your account is approved.</p>
          <Link to="/employee-login" className="btn btn-primary" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div className="brand-logo"><MapPinned size={20} /></div>
          <div style={{ fontWeight: 800, fontSize: 19 }}>GetinRoute</div>
        </div>
        <h1>Create account</h1>
        <p className="sub">Register as an employee or driver. The admin team approves every account.</p>

        <div className="role-pick">
          <button type="button" className={role === 'employee' ? 'active' : ''} onClick={() => setRole('employee')}>
            <Briefcase style={{ margin: '0 auto 8px', color: '#4f46e5' }} />
            <div className="rp-title">Employee</div>
            <div className="rp-sub">Ride the company cab</div>
          </button>
          <button type="button" className={role === 'driver' ? 'active' : ''} onClick={() => setRole('driver')}>
            <Truck style={{ margin: '0 auto 8px', color: '#db2777' }} />
            <div className="rp-title">Driver</div>
            <div className="rp-sub">Drive the company cab</div>
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label>Full name</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="field"><label>{role === 'employee' ? 'Employee ID' : 'Driver ID'}</label><input value={form.emp_id} onChange={set('emp_id')} placeholder="E1001 / D2001" required /></div>
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} placeholder={role === 'employee' ? 'you@company.com' : 'driver@company.com'} required /></div>
            <div className="field"><label>Phone</label><input value={form.phone} onChange={set('phone')} placeholder="+91 …" /></div>
            <div className="field"><label>Password</label><input type="password" value={form.password} onChange={set('password')} minLength={6} required /></div>
            {role === 'driver' && (
              <div className="field full" style={{ background: 'rgba(168,85,247,.08)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(168,85,247,.25)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={14} /> Invite Code</label>
                <input value={form.inviteCode} onChange={set('inviteCode')} placeholder="Get this from your company admin" style={{ marginTop: 4 }} />
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Ask your admin for the company invite code to register as a driver.</div>
              </div>
            )}
            <div className="field"><label>Department</label><input value={form.department} onChange={set('department')} /></div>
            <div className="field full"><label>Designation</label><input value={form.designation} onChange={set('designation')} /></div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
        <p className="auth-switch">Already have an account? <Link to="/employee-login" className="auth-link">Sign in</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/admin/login" className="auth-link" style={{ fontSize: 13 }}>Admin Login</Link>
          <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
          <Link to="/register-company" className="auth-link" style={{ fontSize: 13 }}>Register Company</Link>
        </div>
      </div>
    </div>
  );
}
