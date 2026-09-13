import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/ui';
import { Building2, Eye, EyeOff, Clock, ShieldCheck, ChevronLeft, ChevronRight, Sparkles, CheckCircle2 } from 'lucide-react';

const STEPS = ['Company Information', 'Transportation Requirements', 'Administrator Information', 'Request 10-Day Trial', 'Pending Approval', 'Trial Activated'];

const TRIAL_POINTS = [
  { icon: <ShieldCheck size={15} />, text: 'No upfront payment' },
  { icon: <Clock size={15} />, text: 'Trial requires owner approval' },
  { icon: <Sparkles size={15} />, text: 'Full platform access during the approved trial' },
  { icon: <Clock size={15} />, text: 'Payment required only after the trial' }
];

export default function CompanyOnboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({
    companyName: '', domain: '', phone: '',
    approxEmployees: '', pickupZones: '', shiftType: 'Office / IT',
    adminName: '', adminEmail: '', adminPassword: ''
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const canNext = () => {
    if (step === 1) return !!(form.companyName.trim() && form.domain.trim());
    if (step === 3) return !!(form.adminName.trim() && form.adminEmail.trim() && form.adminPassword.length >= 8);
    return true;
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/company/onboard', {
        companyName: form.companyName,
        domain: form.domain,
        phone: form.phone,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        approxEmployees: form.approxEmployees,
        pickupZones: form.pickupZones,
        shiftType: form.shiftType
      });
      setStep(5);
      setDone(true);
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,.2), transparent), #0f172a' }}>
        <div className="auth-card" style={{ textAlign: 'center', borderTop: '4px solid #7c3aed', maxWidth: 560 }}>
          <div className="onb-progress" style={{ marginBottom: 16 }}>
            {[1, 2, 3, 4].map((s) => <span key={s} className="onb-dot ok" />)}
            <span className="onb-dot wait" />
            <span className="onb-dot" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Step 5 — Pending Approval</h2>
          <CheckCircle2 size={52} style={{ color: '#f59e0b', margin: '10px auto' }} />
          <h1 style={{ fontSize: 20 }}>Request submitted</h1>
          <p className="sub" style={{ marginBottom: 8 }}>
            <strong>{form.companyName}</strong> has been registered.
          </p>
          <p className="sub" style={{ marginBottom: 20 }}>
            Your admin account is <strong>pending owner approval</strong>.
          </p>
          <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 12, padding: '14px 16px', textAlign: 'left', fontSize: 13.5, color: '#374151', marginBottom: 20 }}>
            <b style={{ display: 'block', marginBottom: 6 }}>Step 6 — Trial Activated (what happens next)</b>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>The platform owner reviews and approves your company.</li>
              <li>A <b>10-day free trial</b> starts with full platform access.</li>
              <li>You sign in with the admin email you just created.</li>
              <li>After the trial, payment is requested and verified manually.</li>
            </ol>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => nav('/')}>Back to site</button>
            <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => nav('/admin/login')}>Go to Admin Login</button>
          </div>
        </div>
      </div>
    );
  }

  const stepHead = {
    1: { title: 'Company Information', sub: 'Basic company details to create your workspace.' },
    2: { title: 'Transportation Requirements', sub: 'Optional details so we can tailor your trial after approval.' },
    3: { title: 'Administrator Information', sub: 'This person signs in and runs the company on GetInRoute.' },
    4: { title: 'Request 10-Day Trial', sub: 'Review and submit. The owner approves, then your trial starts.' }
  }[step];

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.25), transparent), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,.2), transparent), #0f172a' }}>
      <div className="auth-card" style={{ borderTop: '4px solid #7c3aed', maxWidth: 540 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
            <Building2 size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Get Started · 10-Day Free Trial</div>
          </div>
        </div>

        <div className="onb-progress" role="list" aria-label={`Step ${step} of 6`}>
          {STEPS.map((s, i) => {
            const n = i + 1;
            const cls = n === step ? 'cur' : n < step ? 'ok' : '';
            return <span key={s} className={`onb-dot ${cls}`} title={s} aria-label={s} />;
          })}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0 14px', textAlign: 'center' }}>
          Step {step} of 6: {STEPS[step - 1]}
        </div>

        <h1>{stepHead.title}</h1>
        <p className="sub" style={{ marginBottom: 18 }}>{stepHead.sub}</p>

        {step === 1 && (
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
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <div className="field full">
              <label>Approximate daily riders</label>
              <input type="number" min="1" value={form.approxEmployees} onChange={set('approxEmployees')} placeholder="e.g. 150" />
            </div>
            <div className="field full">
              <label>Pickup zones / stops</label>
              <input value={form.pickupZones} onChange={set('pickupZones')} placeholder="e.g. Whitefield, HSR Layout, Electronic City" />
            </div>
            <div className="field full">
              <label>Shift type</label>
              <select value={form.shiftType} onChange={set('shiftType')}>
                <option>Office / IT</option>
                <option>Manufacturing / Plant</option>
                <option>BPO / 24x7</option>
                <option>School / Institution</option>
                <option>Other</option>
              </select>
            </div>
            <p className="full" style={{ fontSize: 12.5, color: '#94a3b8', margin: 0 }}>
              Your account is created now — these details help us configure your routes and zones together after approval.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="form-grid">
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
                <input type={showPw ? 'text' : 'password'} value={form.adminPassword} onChange={set('adminPassword')} placeholder="Min 8 characters" minLength={8} required style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '14px 16px', fontSize: 13.5, color: '#334155', marginBottom: 14, display: 'grid', gap: 6 }}>
              <div><b>Company:</b> {form.companyName} ({form.domain})</div>
              <div><b>Phone:</b> {form.phone || '—'}</div>
              <div><b>Riders:</b> {form.approxEmployees || '—'} · <b>Zones:</b> {form.pickupZones || '—'} · <b>Shift:</b> {form.shiftType}</div>
              <div><b>Admin:</b> {form.adminName} ({form.adminEmail})</div>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {TRIAL_POINTS.map((p, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#475569' }}>
                  <span style={{ color: '#10b981' }}>{p.icon}</span> {p.text}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '12px 0 0' }}>
              No payment is collected now. Payment is requested after the trial and verified manually initially.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 1 && step < 5 && (
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setStep(step - 1)}>
              <ChevronLeft size={16} /> Back
            </button>
          )}
          {step === 1 && <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => nav('/')}>Cancel</button>}
          {step < 4 ? (
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!canNext()} onClick={() => setStep(step + 1)}>
              Continue <ChevronRight size={16} />
            </button>
          ) : step === 4 ? (
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={busy} onClick={submit}>
              {busy ? 'Submitting...' : 'Request 10-Day Trial'}
            </button>
          ) : null}
        </div>

        <p className="auth-switch">Already have an account? <Link to="/admin/login" className="auth-link">Sign in</Link></p>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/login" className="auth-link" style={{ fontSize: 13 }}>All sign-in portals</Link>
        </div>
      </div>
    </div>
  );
}