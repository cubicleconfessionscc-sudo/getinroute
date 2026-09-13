import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useInterval, useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { api } from '../../api';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useNoindex } from '../../components/Noindex';
import {
  LayoutDashboard, Route as RouteIcon, Truck, Users, GraduationCap, Bus,
  CalendarClock, ShieldAlert, Home, X, LogOut, Menu, MapPinned, School, Settings
} from 'lucide-react';

const NAV_SCHOOL = [
  { label: 'Overview', items: [
    { to: '/school', icon: <LayoutDashboard size={18} />, text: 'Dashboard', end: true },
    { to: '/school/sos', icon: <ShieldAlert size={18} />, text: 'SOS & Safety' },
    { to: '/school/geofence', icon: <MapPinned size={18} />, text: 'Geofence Log' }
  ]},
  { label: 'People', items: [
    { to: '/school/students', icon: <GraduationCap size={18} />, text: 'Students' },
    { to: '/school/parents', icon: <Users size={18} />, text: 'Parents' },
    { to: '/school/drivers', icon: <Bus size={18} />, text: 'Drivers' }
  ]},
  { label: 'Operations', items: [
    { to: '/school/routes', icon: <RouteIcon size={18} />, text: 'Routes & Stops' },
    { to: '/school/vehicles', icon: <Truck size={18} />, text: 'Vehicles' },
    { to: '/school/schedules', icon: <CalendarClock size={18} />, text: 'Schedules' },
    { to: '/school/zones', icon: <Home size={18} />, text: 'Safety Zones' }
  ]},
  { label: 'Configuration', items: [
    { to: '/school/settings', icon: <Settings size={18} />, text: 'Settings' }
  ]}
];

export default function SchoolLayout() {
  useNoindex(); // keep private dashboards out of search engine indexes
  const { user, logout } = useAuth();
  const toast = useToast();
  const [openSos, setOpenSos] = useState(0);
  const [school, setSchool] = useState(null);
  const [settings, setSettings] = useState({});
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  const nav = useNavigate();
  const location = useLocation();

  useInterval(() => {
    api.get('/api/school/me').then((r) => {
      if (r?.school) setSchool(r.school);
      if (r?.settings) setSettings(r.settings);
      if (r?.stats?.open_sos != null) setOpenSos(r.stats.open_sos);
    }).catch(() => {});
  }, 20000);

  useSocketEvent('sos:new', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    setOpenSos((c) => c + 1);
    toast('🚨 New SOS alert raised by a parent', 'err');
  });
  useSocketEvent('school:dropConfirmed', () => toast('✔ A parent confirmed a drop-off', 'ok'));
  useSocketEvent('school:dropAwaitingOtp', () => toast('🔵 A drop is awaiting parent OTP confirmation', 'info'));

  const initials = (user?.name || 'A').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  // School vertical gets its own identity (green/teal) distinct from the
  // company admin (pink). A school can override via Settings -> primary color,
  // but the default and the tertiary accent stay in the greens family so the
  // portal reads as "school" at a glance.
  const primary = settings.primaryColor || '#0d9488';
  const secondary = '#22c55e';

  return (
    <div className="shell school-shell">
      <style>{`:root{--primary:${primary};--primary-2:${primary};--grad:linear-gradient(135deg,${primary},${secondary})}`}</style>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo" style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>G</div>
          <div>
            <div className="brand-name">{settings.displayName || school?.name || 'GetInRoute'}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>School Portal</div>
          </div>
          <button className="btn btn-ghost btn-icon sidebar-close-btn" style={{ marginLeft: 'auto', color: '#fff' }} onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {NAV_SCHOOL.map((group) => (
          <React.Fragment key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                {item.icon} {item.text}
                {item.to === '/school/sos' && openSos > 0 && (
                  <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, padding: '1px 7px', fontWeight: 700 }}>{openSos}</span>
                )}
              </NavLink>
            ))}
          </React.Fragment>
        ))}
        <div className="sidebar-foot">
          <button className="nav-item" style={{ width: '100%', border: 'none', background: 'none' }} onClick={logout}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <div className="spacer" />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#047857', background: 'rgba(16,185,129,0.14)', padding: '4px 10px', borderRadius: 999 }}>🎓 School</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{user?.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>School Administrator</div>
          </div>
          <div className="avatar" style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>{initials}</div>
        </div>
        <div style={{ flex: 1 }}>
          <ErrorBoundary key={location?.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}