import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useInterval, useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { api } from '../../api';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useNoindex } from '../../components/Noindex';
import ThemePicker from '../../components/ThemePicker';
import {
  LayoutDashboard, MapPinned, Route as RouteIcon, Truck, Users, ClipboardCheck,
  CalendarClock, FileSpreadsheet, Bell, LogOut, Menu, X, MessageCircle, MessageSquare, History,
  Settings, ShieldAlert, UserX, Building2, Shield, Ticket, HeadphonesIcon, School, ParkingCircle, XCircle, Database,
  CreditCard, Flag, ShieldCheck, Brain, BarChart3, FileText, DollarSign, Send, Activity, Zap
} from 'lucide-react';

const NAV_OWNER = [
  { label: 'Overview', items: [
    { to: '/admin', icon: <LayoutDashboard size={18} />, text: 'Dashboard', end: true },
    { to: '/admin/tracking', icon: <MapPinned size={18} />, text: 'Live Tracking' }
  ]},
  { label: 'Platform', items: [
    { to: '/admin/company-approvals', icon: <Building2 size={18} />, text: 'Company Approvals' },
    { to: '/admin/subscription', icon: <CreditCard size={18} />, text: 'Subscription Center' },
    { to: '/admin/feature-flags', icon: <Flag size={18} />, text: 'Feature Flags' },
    { to: '/admin/announcements', icon: <Bell size={18} />, text: 'Announcements' },
    { to: '/admin/schools', icon: <School size={18} />, text: 'Schools' },
    { to: '/admin/admin-accounts', icon: <Shield size={18} />, text: 'Admin Accounts' },
    { to: '/admin/approvals', icon: <Users size={18} />, text: 'Drivers & Employees' },
    { to: '/admin/employees', icon: <Users size={18} />, text: 'All Users' }
  ]},
  { label: 'Intelligence', items: [
    { to: '/admin/command-center', icon: <Activity size={18} />, text: 'Command Center' },
    { to: '/admin/automation', icon: <Zap size={18} />, text: 'Automation Builder' },
    { to: '/admin/intelligence', icon: <Brain size={18} />, text: 'AI Intelligence' },
    { to: '/admin/transport-manager', icon: <Send size={18} />, text: 'Transport Manager' }
  ]},
  { label: 'Configuration', items: [
    { to: '/admin/policies', icon: <ShieldCheck size={18} />, text: 'Policies' },
    { to: '/admin/documents', icon: <FileText size={18} />, text: 'Documents' },
    { to: '/admin/billing', icon: <DollarSign size={18} />, text: 'Billing' },
    { to: '/admin/notification-templates', icon: <Bell size={18} />, text: 'Notification Templates' },
    { to: '/admin/reports', icon: <BarChart3 size={18} />, text: 'Analytics Reports', flag: 'ANALYTICS' },
    { to: '/admin/system-health', icon: <Activity size={18} />, text: 'System Health' },
    { to: '/admin/settings', icon: <Settings size={18} />, text: 'Settings' },
    { to: '/admin/operations', icon: <Building2 size={18} />, text: 'Company Operations' },
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
    { to: '/admin/drivers', icon: <Truck size={18} />, text: 'Driver Accounts' },
    { to: '/admin/driver-assignments', icon: <Truck size={18} />, text: 'Driver Assignments' },
    { to: '/admin/schedules', icon: <CalendarClock size={18} />, text: 'Schedules' },
    { to: '/admin/trips', icon: <History size={18} />, text: 'All Trips' },
    { to: '/admin/vendors', icon: <Building2 size={18} />, text: 'Vendor Management', flag: 'VENDOR_MODULE' }
  ]},
  { label: 'Operations', items: [
    { to: '/admin/parking-lines', icon: <ParkingCircle size={18} />, text: 'Parking Lines' },
    { to: '/admin/safety', icon: <ShieldAlert size={18} />, text: 'Safety Queue' },
    { to: '/admin/cancellations', icon: <XCircle size={18} />, text: 'Cancellations' }
  ]},
  { label: 'Communicate', items: [
    { to: '/admin/chat', icon: <MessageCircle size={18} />, text: 'Messages' },
    { to: '/admin/announcements', icon: <Bell size={18} />, text: 'Announcements' },
    { to: '/admin/sms-log', icon: <MessageSquare size={18} />, text: 'SMS Log' },
    { to: '/admin/tickets', icon: <Ticket size={18} />, text: 'Support Tickets' }
  ]},
  { label: 'Reports', items: [
    { to: '/admin/exports', icon: <FileSpreadsheet size={18} />, text: 'Export Spreadsheets' },
    { to: '/admin/reports', icon: <BarChart3 size={18} />, text: 'Analytics Reports', flag: 'ANALYTICS' },
    { to: '/admin/notifications', icon: <Bell size={18} />, text: 'Notifications' },
    { to: '/admin/notification-templates', icon: <Send size={18} />, text: 'Notification Templates' },
    { to: '/admin/checkin-logs', icon: <ShieldAlert size={18} />, text: 'Check-In/Out Logs' },
    { to: '/admin/no-shows', icon: <UserX size={18} />, text: 'No-Show Report' }
  ]},
  { label: 'Intelligence', items: [
    { to: '/admin/command-center', icon: <Activity size={18} />, text: 'Command Center', flag: 'AI_COMMAND_CENTER' },
    { to: '/admin/automation', icon: <Zap size={18} />, text: 'Automation Builder' },
    { to: '/admin/intelligence', icon: <Brain size={18} />, text: 'AI Intelligence' },
    { to: '/admin/transport-manager', icon: <Send size={18} />, text: 'Transport Manager' },
    { to: '/admin/what-if', icon: <Activity size={18} />, text: 'What-If Simulator' }
  ]},
  { label: 'Configuration', items: [
    { to: '/admin/policies', icon: <ShieldCheck size={18} />, text: 'Policies' },
    { to: '/admin/documents', icon: <FileText size={18} />, text: 'Documents', flag: 'DOCUMENT_MANAGEMENT' },
    { to: '/admin/billing', icon: <DollarSign size={18} />, text: 'Billing' },
    { to: '/admin/feature-flags', icon: <Flag size={18} />, text: 'Feature Flags' },
    { to: '/admin/system-health', icon: <Activity size={18} />, text: 'System Health' },
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
    { to: '/admin/settings', icon: <Settings size={18} />, text: 'Settings' },
    { to: '/admin/schedules', icon: <CalendarClock size={18} />, text: 'Schedules' },
    { to: '/admin/trips', icon: <History size={18} />, text: 'All Trips' },
    { to: '/admin/documents', icon: <FileText size={18} />, text: 'Documents', flag: 'DOCUMENT_MANAGEMENT' }
  ]},
  { label: 'Operations', items: [
    { to: '/admin/parking-lines', icon: <ParkingCircle size={18} />, text: 'Parking Lines' },
    { to: '/admin/safety', icon: <ShieldAlert size={18} />, text: 'Safety Queue' },
    { to: '/admin/cancellations', icon: <XCircle size={18} />, text: 'Cancellations' }
  ]},
  { label: 'Communicate', items: [
    { to: '/admin/chat', icon: <MessageCircle size={18} />, text: 'Messages' },
    { to: '/admin/announcements', icon: <Bell size={18} />, text: 'Announcements' },
    { to: '/admin/sms-log', icon: <MessageSquare size={18} />, text: 'SMS Log' },
    { to: '/admin/tickets', icon: <Ticket size={18} />, text: 'Support Tickets' }
  ]},
  { label: 'Intelligence', items: [
    { to: '/admin/command-center', icon: <Activity size={18} />, text: 'Command Center', flag: 'AI_COMMAND_CENTER' },
    { to: '/admin/automation', icon: <Zap size={18} />, text: 'Automation Builder' },
    { to: '/admin/transport-manager', icon: <Send size={18} />, text: 'Transport Manager' },
    { to: '/admin/what-if', icon: <Activity size={18} />, text: 'What-If Simulator' }
  ]}
];

export default function AdminLayout() {
  useNoindex(); // keep private dashboards out of search engine indexes
  const { user, logout } = useAuth();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  const [flags, setFlags] = useState(null);
  const nav = useNavigate();
  const location = useLocation();

  // Effective feature flags for THIS company. When the owner disables a feature
  // for a company, the matching nav item is hidden for that company's portal.
  useEffect(() => {
    api.get('/api/v3/flags/mine')
      .then((r) => {
        const map = {};
        (Array.isArray(r) ? r : []).forEach((f) => { map[f.flag_key] = !!f.enabled; });
        setFlags(map);
      })
      .catch(() => setFlags(null));
  }, [user?.id]);

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
  // Fail-open: until flags load (or if the request fails) every item is shown.
  const flagOn = (k) => !k || !flags || flags[k] !== false;
  const visibleNav = navItems
    .map((g) => ({ ...g, items: g.items.filter((it) => flagOn(it.flag)) }))
    .filter((g) => g.items.length);

  return (
    <div className="shell">
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">G</div>
          <div><div className="brand-name">GetinRoute</div><div style={{ fontSize: 11, color: '#64748b' }}>{user?.isOwner ? 'Owner Console' : 'Admin Console'}</div></div>
          <button className="btn btn-ghost btn-icon sidebar-close-btn" style={{ marginLeft: 'auto', color: 'var(--text)' }} onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {visibleNav.map((group) => (
          <React.Fragment key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => { if (window.innerWidth <= 900) setOpen(false); }}>
                {item.icon} {item.text}
              </NavLink>
            ))}
          </React.Fragment>
        ))}
        <div className="sidebar-foot">
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', padding: '6px 8px 4px' }}>Theme</div>
          <div style={{ padding: '0 6px 10px' }}>
            <ThemePicker storageKey={isVendor ? 'getinroute-theme-vendor' : 'getinroute-theme-admin'} />
          </div>
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
