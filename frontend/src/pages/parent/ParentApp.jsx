import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import BackButton from '../../components/BackButton';
import { Home, ShieldAlert, User, LogOut, Bell } from 'lucide-react';

const navs = [
  { to: '/parent', icon: <Home />, label: 'Home', end: true },
  { to: '/parent/sos', icon: <ShieldAlert />, label: 'SOS' },
  { to: '/parent/account', icon: <User />, label: 'Account', end: false }
];

export default function ParentApp() {
  const { user, logout } = useAuth();

  return (
    <div className="mobile-app">
      <div className="mobile-head" style={{ background: 'linear-gradient(135deg,#db2777,#f59e0b)' }}>
        <div className="row">
          <div>
            <h1>Hi, {user?.name?.split(' ')[0]} 👋</h1>
            <div className="sub">Parent · GetInRoute School</div>
          </div>
          <div className="spacer" />
          <BackButton label="Back" className="btn btn-sm" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} to="/parent" />
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }}><Bell size={18} /></button>
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={logout}><LogOut size={18} /></button>
        </div>
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