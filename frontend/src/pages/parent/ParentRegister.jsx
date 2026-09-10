import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setToken } from '../../api';
import { useToast } from '../../components/ui';
import { School, Eye, EyeOff } from 'lucide-react';

export default function ParentRegister() {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', childInviteCode: '', relation: 'guardian' });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/auth/parent/register', form);
      setToken(r.token);
      localStorage.setItem('gir_user', JSON.stringify(r.user));
      window.location.href = '/parent';
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ borderTop: '4px solid #db2777' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="brand-logo" style={{ background: 'linear-gradient(135deg,#db2777,#f59e0b)' }}><School size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute School</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Parent sign-up</div>
          </div>
        </div>
        <h1>Join your school's bus tracking</h1>
        <p className="sub">Create your parent account. You'll link your child with the code the school sent you.</p>
        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Your name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Email *</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Phone (mobile, for SMS alerts)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91…" autoComplete="tel" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Password * (min 6)</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Child's Parent link code *</label>
            <input value={form.childInviteCode} onChange={(e) => setForm({ ...form, childInviteCode: e.target.value })} placeholder="e.g. SCHL-1A2B3C" />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Relation to child</label>
            <select value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
              <option value="guardian">Guardian</option><option value="parent">Parent</option><option value="relative">Relative</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg,#db2777,#f59e0b)', borderColor: 'transparent' }} disabled={busy}>
            {busy ? 'Creating account…' : 'Create parent account'}
          </button>
        </form>
        <p className="auth-switch">Already a parent? <Link to="/login" className="auth-link">Sign in</Link></p>
      </div>
    </div>
  );
}