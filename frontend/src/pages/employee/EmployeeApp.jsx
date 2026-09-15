import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth';
import { Home, MapPin, History, Star, LogOut, MessageCircle, Ticket } from 'lucide-react';
import { MapPinned } from 'lucide-react';
import ThemeButton from '../../components/ThemeButton';

export default function EmployeeApp() {
  const { user, logout } = useAuth();

  const navs = [
    { to: '/app', icon: <Home size={18} />, label: 'Home', end: true },
    { to: '/app/track', icon: <MapPin size={18} />, label: 'Track Cab', end: false },
    { to: '/app/address', icon: <MapPinned size={18} />, label: 'My Address', end: false },
    { to: '/app/history', icon: <History size={18} />, label: 'History', end: false },
    { to: '/app/feedback', icon: <Star size={18} />, label: 'Feedback', end: false },
    { to: '/app/tickets', icon: <Ticket size={18} />, label: 'Tickets', end: false }
  ];

  return (
    <div className="mobile-app">
      <div className="mobile-head">
        <div className="row">
          <div>
            <h1>Hi, {user?.name?.split(' ')[0]}</h1>
            <div className="sub">{user?.employeeId || ''} · {user?.department || 'Employee'}</div>
          </div>
          <div className="spacer" />
          <ThemeButton compact />
          <button className="btn btn-icon" style={{ background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={logout}>
            <LogOut size={18} />
          </button>
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
