import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import {
  LayoutDashboard, Car, CalendarDays, Ticket, MapPin, Home, History, LifeBuoy, Settings, LogOut, Bell, Building2
} from 'lucide-react';

export default function EmployeeApp() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const navs = [
    { to: '/app', icon: <LayoutDashboard size={18} />, label: 'Dashboard', end: true },
    { to: '/app/book', icon: <Car size={18} />, label: 'Book a Ride', end: false },
    { to: '/app/schedule', icon: <CalendarDays size={18} />, label: 'My Schedule', end: false },
    { to: '/app/track', icon: <MapPin size={18} />, label: 'Track Vehicle', end: false },
    { to: '/app/address', icon: <Home size={18} />, label: 'My Address', end: false },
    { to: '/app/location', icon: <Building2 size={18} />, label: 'Company Location', end: false },
    { to: '/app/history', icon: <History size={18} />, label: 'History', end: false },
    { to: '/app/notifications', icon: <Bell size={18} />, label: 'Notifications', end: false },
    { to: '/app/tickets', icon: <LifeBuoy size={18} />, label: 'Support', end: false }
  ];

  const firstName = user?.name?.split(' ')[0] || 'Employee';
  const empId = user?.employeeId || user?.emp_id || user?.id || '';

  return (
    <div className="emp-shell">
      <aside className="emp-side">
        <div className="emp-brand">
          <span className="emp-brand-dot">G</span>
          <span>GetInRoute</span>
        </div>
        <nav className="emp-nav">
          {navs.map((n, i) => (
            <NavLink key={i} to={n.to} end={n.end} className={({ isActive }) => `emp-navitem ${isActive ? 'active' : ''}`}>
              {n.icon} <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="emp-side-foot">
          <NavLink to="/app/feedback" className={({ isActive }) => `emp-navitem ${isActive ? 'active' : ''}`}>
            <Settings size={18} /> <span>Feedback</span>
          </NavLink>
          <button className="emp-navitem emp-logout" onClick={logout}><LogOut size={18} /> <span>Logout</span></button>
        </div>
      </aside>

      <div className="emp-main">
        <header className="emp-top">
          <button className="emp-back" onClick={() => nav('/app')}>GetInRoute</button>
          <div className="emp-top-right">
            <NavLink to="/app/notifications" className="emp-bell" aria-label="Notifications" title="Notifications"><Bell size={18} /></NavLink>
            <div className="emp-user">
              <div className="emp-avatar">{(firstName || 'E')[0]}</div>
              <div className="emp-user-meta">
                <div className="emp-user-name">{user?.name || firstName}</div>
                <div className="emp-user-id">Employee ID {empId}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="emp-content">
          <Outlet />
        </main>

        <nav className="emp-bottomnav">
          <NavLink to="/app" end className={({ isActive }) => isActive ? 'active' : ''}><LayoutDashboard size={20} /><span>Home</span></NavLink>
          <NavLink to="/app/history" className={({ isActive }) => isActive ? 'active' : ''}><History size={20} /><span>Trips</span></NavLink>
          <NavLink to="/app/book" className="emp-plus"><Car size={22} /></NavLink>
          <NavLink to="/app/track" className={({ isActive }) => isActive ? 'active' : ''}><MapPin size={20} /><span>Track</span></NavLink>
          <NavLink to="/app/address" className={({ isActive }) => isActive ? 'active' : ''}><Home size={20} /><span>Profile</span></NavLink>
        </nav>
      </div>
    </div>
  );
}
