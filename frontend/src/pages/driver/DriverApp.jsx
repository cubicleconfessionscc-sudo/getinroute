import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import BackButton from '../../components/BackButton';
import { Home, Route as RouteIcon, Star, LogOut, Bell, MessageCircle, KeyRound, CheckCheck, LifeBuoy, Settings } from 'lucide-react';
import { api } from '../../api';
import { useInterval } from '../../components/ui';
import ThemeButton from '../../components/ThemeButton';

export default function DriverApp() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const [today, setToday] = useState(null);
  const [duty, setDuty] = useState(null);

  const load = () => {
    api.get('/api/driver/today').then((r) => setToday(r && typeof r === 'object' ? r : null)).catch(() => {});
    // Notifications + chat both contribute to the badge — ADD them, never
    // overwrite one with the other (the old code clobbered the chat count).
    Promise.all([
      api.get('/api/notifications').then((n) => Number((n && n.unread) || 0)).catch(() => 0),
      api.get('/api/chat/conversations').then((rows) => (Array.isArray(rows) ? rows : []).reduce((s, r) => s + (r.unread || 0), 0)).catch(() => 0)
    ]).then(([nUnread, cUnread]) => setUnread(nUnread + cUnread)).catch(() => {});
    api.get('/api/driver/duty').then((d) => setDuty(d || null)).catch(() => setDuty(null));
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 10000);

  const navs = [
    { to: '/driver', icon: <Home />, label: 'Home', end: true },
    { to: '/driver/duty', icon: <KeyRound />, label: 'Duty', end: false },
    { to: '/driver/route', icon: <RouteIcon />, label: 'My Route', end: false },
    { to: '/driver/chat', icon: <MessageCircle />, label: 'Chat', end: false },
    { to: '/driver/feedback', icon: <Star />, label: 'Feedback', end: false },
    { to: '/driver/help', icon: <LifeBuoy />, label: 'Help & SOS', end: false },
    { to: '/driver/settings', icon: <Settings />, label: 'Settings', end: false },
    { to: '/driver/notifications', icon: <CheckCheck />, label: 'Notifications', end: false }
  ];

  return (
    <div className="mobile-app">
      <div className="mobile-head">
        <div className="row">
          <div>
            <h1>Hello, {user?.name?.split(' ')[0]} 👋</h1>
            <div className="sub">{user?.emp_id} · {user?.vertical === 'school' ? 'School Driver' : 'Driver'}</div>
          </div>
          <div className="spacer" />
          <BackButton label="Back" className="btn btn-sm" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} />
          <ThemeButton compact />
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff', position: 'relative' }}
            onClick={() => nav('/driver/notifications')} aria-label="Notifications" title="Notifications">
            <Bell size={18} />
            {unread > 0 && (
              <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={logout}><LogOut size={18} /></button>
        </div>
        {/* Duty banner — the APK shows the same strip on Driver Home. */}
        <div onClick={() => nav('/driver/duty')} style={{ marginTop: 12, borderRadius: 14, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', background: duty ? 'rgba(34,197,94,.22)' : 'rgba(245,158,11,.22)' }}>
          <KeyRound size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{duty ? 'On duty' : 'Not on duty'}</div>
            <div style={{ fontSize: 12, opacity: .9 }}>{duty ? `Location #${duty.company_location_id || '—'}` : 'Tap to enter your Invite ID'}</div>
          </div>
          {duty ? <span className="badge badge-green">Active</span> : <span className="badge badge-slate">Idle</span>}
        </div>
        {today?.vehicle && (
          <div style={{ marginTop: 12, background: 'rgba(255,255,255,.14)', borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontSize: 24 }}>🚌</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{today.vehicle.vehicle_name}</div>
              <div style={{ fontSize: 12, opacity: .85 }}>{today.vehicle.plate} · Line {today.vehicle.line}, Trip {today.vehicle.trip}</div>
            </div>
            {today.vehicle.status === 'active' ? <span className="badge badge-green">Live</span> : <span className="badge badge-slate">Idle</span>}
          </div>
        )}
      </div>
      <div className="mobile-body">
        <Outlet />
      </div>
      <nav className="mobile-nav">
        {navs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => isActive ? 'active' : ''}>
            {n.icon} {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
