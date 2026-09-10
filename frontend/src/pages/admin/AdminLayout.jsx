import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useInterval, useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { api } from '../../api';
import ErrorBoundary from '../../components/ErrorBoundary';
import {
  LayoutDashboard, MapPinned, Route as RouteIcon, Truck, Users, ClipboardCheck,
  CalendarClock, FileSpreadsheet, Bell, LogOut, Menu, X, MessageCircle, MessageSquare, History,
  Settings, ShieldAlert, UserX, Building2, Shield, Ticket, HeadphonesIcon, School, ParkingCircle, XCircle, Database
} from 'lucide-react';

const NAV_OWNER = [
  { label: 'Overview', items: [
    { to: '/admin', icon: <LayoutDashboard size={18} />, text: 'Dashboard', end: true },
    { to: '/admin/tracking', icon: <MapPinned size={18} />, text: 'Live Tracking' }
  ]},
  { label: 'Platform', items: [
    { to: '/admin/company-approvals', icon: <Building2 size={18} />, text: 'Company Approvals' },
    { to: '/admin/schools', icon: <School size={18} />, text: 'Schools' },
    { to: '/admin/admin-accounts', icon: <Shield size={18} />, text: 'Admin Accounts' },
    { to: '/admin/approvals', icon: <Users size={18} />, text: 'Drivers & Employees' },
    { to: '/admin/employees', icon: <Users size={18} />, text: 'All Users' }
  ]},
  { label: 'Configuration', items: [
    { to: '/admin/settings', icon: <Settings size={18} />, text: 'Settings' },
    { to: '/admin/cs', icon: <HeadphonesIcon size={18} />, text: 'CS & Owner Portal' },
    { to: '/admin/raw-data', icon: <Database size={18} />, text: 'Raw Data' }
  ]}
];

const NAV_ADMIN = [
  { label: 'Overview', items: [
    { to: '/admin', icon: <LayoutDashboard size={18} />, text: 'Dashboard', end: true },
    { to: '/admin/tracking', icon: <MapPinned size={18} />, text: 'Live Tracking' }
  ]},
  { label: 'Manage', items: [
    { to: '/admin/routes', icon: <RouteIcon size={18} />, text: 'Routes & Speed Limits' },
    { to: '/admin/vehicles', icon: <Truck size={18} />, text: 'Vehicles & Drivers' },
    { to: '/admin/employees', icon: <Users size={18} />, text: 'Employees' },
    { to: '/admin/approvals', icon: <ClipboardCheck size={18} />, text: 'Approvals' },
    { to: '/admin/schedules', icon: <CalendarClock size={18} />, text: 'Schedules' },
    { to: '/admin/trips', icon: <History size={18} />, text: 'All Trips' },
    { to: '/admin/vendors', icon: <Building2 size={18} />, text: 'Vendor Management' }
  ]},
  { label: 'Operations', items: [
    { to: '/admin/parking-lines', icon: <ParkingCircle size={18} />, text: 'Parking Lines' },
    { to: '/admin/safety', icon: <ShieldAlert size={18} />, text: 'Safety Queue' },
    { to: '/admin/cancellations', icon: <XCircle size={18} />, text: 'Cancellations' }
  ]},
  { label: 'Communicate', items: [
    { to: '/admin/chat', icon: <MessageCircle size={18} />, text: 'Messages' },
    { to: '/admin/sms-log', icon: <MessageSquare size={18} />, text: 'SMS Log' },
    { to: '/admin/tickets', icon: <Ticket size={18} />, text: 'Support Tickets' }
  ]},
  { label: 'Reports', items: [
    { to: '/admin/exports', icon: <FileSpreadsheet size={18} />, text: 'Export Spreadsheets' },
    { to: '/admin/notifications', icon: <Bell size={18} />, text: 'Notifications' },
    { to: '/admin/checkin-logs', icon: <ShieldAlert size={18} />, text: 'Check-In/Out Logs' },
    { to: '/admin/no-shows', icon: <UserX size={18} />, text: 'No-Show Report' }
  ]},
  { label: 'Configuration', items: [
    { to: '/admin/settings', icon: <Settings size={18} />, text: 'Settings' }
  ]}
];

const NAV_VENDOR = [
  { label: 'Overview', items: [
    { to: '/admin', icon: <LayoutDashboard size={18} />, text: 'Dashboard', end: true },
    { to: '/admin/tracking', icon: <MapPinned size={18} />, text: 'Live Tracking' }
  ]},
  { label: 'Manage', items: [
    { to: '/admin/routes', icon: <RouteIcon size={18} />, text: 'Routes' },
    { to: '/admin/vehicles', icon: <Truck size={18} />, text: 'Vehicles & Drivers' },
    { to: '/admin/employees', icon: <Users size={18} />, text: 'Employees' },
    { to: '/admin/schedules', icon: <CalendarClock size={18} />, text: 'Schedules' },
    { to: '/admin/trips', icon: <History size={18} />, text: 'All Trips' }
  ]},
  { label: 'Operations', items: [
    { to: '/admin/parking-lines', icon: <ParkingCircle size={18} />, text: 'Parking Lines' },
    { to: '/admin/safety', icon: <ShieldAlert size={18} />, text: 'Safety Queue' },
    { to: '/admin/cancellations', icon: <XCircle size={18} />, text: 'Cancellations' }
  ]},
  { label: 'Communicate', items: [
    { to: '/admin/chat', icon: <MessageCircle size={18} />, text: 'Messages' },
    { to: '/admin/sms-log', icon: <MessageSquare size={18} />, text: 'SMS Log' },
    { to: '/admin/tickets', icon: <Ticket size={18} />, text: 'Support Tickets' }
  ]}
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  const nav = useNavigate();
  const location = useLocation();

  useInterval(() => {
    api.get('/api/admin/stats').then((s) => setUnread(Number(s?.unread_notifications) || 0)).catch(() => {});
  }, 20000);

  useSocketEvent('notification', (n) => {
    setUnread((u) => (Number.isFinite(u) ? u + 1 : 1));
    toast(`🔔 ${n?.title || 'New notification'}`, 'info');
  });
  useSocketEvent('alert', (a) => {
    if (!a || typeof a !== 'object') return;
    const text =
      a.message ||
      a.title ||
      (a.vehicle_name != null && a.speed != null
        ? `${a.vehicle_name} breached ${Math.round(a.speed)} km/h`
        : 'Safety alert triggered');
    toast(`⚠️ ${text}`, 'err');
  });

  const initials = (user?.name || 'A').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const navItems = user?.isOwner ? NAV_OWNER : (user?.role === 'vendor' ? NAV_VENDOR : NAV_ADMIN);
  const isVendor = user?.role === 'vendor';

  return (
    <div className="shell">
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">G</div>
          <div><div className="brand-name">GetinRoute</div><div style={{ fontSize: 11, color: '#64748b' }}>{user?.isOwner ? 'Owner Console' : 'Admin Console'}</div></div>
          <button className="btn btn-ghost btn-icon sidebar-close-btn" style={{ marginLeft: 'auto', color: '#fff' }} onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {navItems.map((group) => (
          <React.Fragment key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                {item.icon} {item.text}
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
          {!isVendor && (
            <div className="bell-wrap">
              <button className="btn btn-ghost btn-icon" onClick={() => nav('/admin/notifications')}><Bell size={19} /></button>
              {unread > 0 && <span className="bell-dot" />}
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{user?.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{user?.isOwner ? 'Platform Owner' : (isVendor ? 'Vendor' : 'Administrator')}</div>
          </div>
          <div className="avatar">{initials}</div>
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
