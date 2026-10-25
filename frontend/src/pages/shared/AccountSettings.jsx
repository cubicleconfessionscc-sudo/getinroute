import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import BackButton from '../../components/BackButton';
import ThemeButton from '../../components/ThemeButton';
import { KeyRound, LifeBuoy, LogOut, Palette, ShieldCheck, User } from 'lucide-react';

/* Web twin of the mobile Settings screen (employee + driver): account facts,
   password change, theme and sign-out. */
export default function AccountSettings({ kind = 'employee' }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) return toast('New password must be at least 8 characters.', 'err');
    if (newPassword !== confirm) return toast('The new passwords do not match.', 'err');
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { oldPassword, newPassword });
      toast('Password updated.');
      setOldPassword(''); setNewPassword(''); setConfirm('');
    } catch (err) {
      toast(err.message || 'Could not change the password.', 'err');
    } finally { setBusy(false); }
  };

  const rows = [
    ['Name', user?.name || '—'],
    ['Login ID', user?.emp_id || '—'],
    ['Email', user?.email || '—'],
    ['Phone', user?.phone || '—'],
    ['Role', user?.role || '—'],
    ['Office location', user?.company_location_id ? `Location #${user.company_location_id}` : user?.company_location_id === null ? 'Not selected' : '—']
  ];

  return (
    <div className="page" style={{ display: 'grid', gap: 14, maxWidth: 860 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={22} color="var(--primary)" /> Settings
          </div>
          <div className="page-sub">Your account, password and appearance.</div>
        </div>
        <BackButton to={kind === 'driver' ? '/driver' : '/app'} />
      </div>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ShieldCheck size={16} color="var(--primary)" />
          <b style={{ fontSize: 15 }}>Account</b>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 12, fontSize: 13.5, borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
              <span style={{ width: 140, color: 'var(--muted)', flexShrink: 0 }}>{k}</span>
              <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{v}</span>
            </div>
          ))}
        </div>
        {kind === 'employee' ? (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0' }}>
            Change your office location under <Link className="auth-link" to="/app/location">Company location</Link>.
          </p>
        ) : null}
      </section>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <KeyRound size={16} color="var(--primary)" />
          <b style={{ fontSize: 15 }}>Change password</b>
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" required />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 8 characters)" autoComplete="new-password" required />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" required />
          <button className="btn btn-primary" disabled={busy || !oldPassword || !newPassword} style={{ justifySelf: 'start' }}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Palette size={17} color="var(--primary)" />
        <div style={{ flex: 1, minWidth: 180 }}>
          <b style={{ fontSize: 14 }}>Appearance</b>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Switch between dark, light or system theme.</div>
        </div>
        <ThemeButton />
      </section>

      <section className="card" style={{ padding: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-outline" to={kind === 'driver' ? '/driver/help' : '/app/help'}><LifeBuoy size={15} /> Help &amp; SOS</Link>
        <button className="btn btn-ghost" onClick={logout}><LogOut size={15} /> Log out</button>
      </section>
    </div>
  );
}
