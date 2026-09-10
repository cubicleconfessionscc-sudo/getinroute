import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import { Home, Route as RouteIcon, Star, LogOut, Bell, MessageCircle } from 'lucide-react';
import { api } from '../../api';
import { useInterval } from '../../components/ui';

export default function DriverApp() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const [today, setToday] = useState(null);

  const load = () => {
    api.get('/api/driver/today').then((r) => setToday(r && typeof r === 'object' ? r : null)).catch(() => {});
    api.get('/api/me/notifications').then((n) => setUnread((Array.isArray(n) ? n : []).filter((x) => !x.read).length)).catch(() => {});
    api.get('/api/chat/conversations').then((rows) => setUnread((Array.isArray(rows) ? rows : []).reduce((s, r) => s + (r.unread || 0), 0))).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 10000);

  const navs = [
    { to: '/driver', icon: <Home />, label: 'Home', end: true },
    { to: '/driver/route', icon: <RouteIcon />, label: 'My Route', end: false },
    { to: '/driver/chat', icon: <MessageCircle />, label: 'Chat', end: false },
    { to: '/driver/feedback', icon: <Star />, label: 'Feedback', end: false }
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
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}><Bell size={18} /></button>
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={logout}><LogOut size={18} /></button>
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
