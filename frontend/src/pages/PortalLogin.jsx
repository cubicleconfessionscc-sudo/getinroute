import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPinned, Shield, Building2, Truck, School, LogIn, ChevronRight } from 'lucide-react';

const ROLES = [
  { key: 'admin', icon: <Shield size={24} />, title: 'Admin', desc: 'Platform owner and system administration.', to: '/admin/login', color: '#4f46e5' },
  { key: 'company', icon: <Building2 size={24} />, title: 'Company', desc: 'Manage employee transportation and operations.', to: '/company/login', color: '#7c3aed' },
  { key: 'vendor', icon: <Truck size={24} />, title: 'Vendor', desc: 'Manage transportation operations, drivers, vehicles and billing.', to: '/vendor/login', color: '#db2777' },
  { key: 'school', icon: <School size={24} />, title: 'School', desc: 'Manage student transportation and school operations.', to: '/school/login', color: '#0d9488' }
];

export default function PortalLogin() {
  const nav = useNavigate();

  return (
    <div className="auth-bg" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.3), transparent), radial-gradient(900px 500px at 110% 110%, rgba(13,148,136,.22), transparent), #0f172a' }}>
      <div className="auth-card" style={{ maxWidth: 720, borderTop: '4px solid #7c3aed' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div className="brand-logo"><MapPinned size={20} /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>GetInRoute</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Sign in portal</div>
          </div>
        </div>

        <h1>Welcome to GetInRoute</h1>
        <p className="sub">Where do you want to sign in?</p>

        <div className="portal-roles">
          {ROLES.map((r) => (
            <button type="button" key={r.key} className="portal-role" onClick={() => nav(r.to)}>
              <div className="portal-role-icon" style={{ color: r.color, background: `${r.color}1a` }}>{r.icon}</div>
              <div className="portal-role-body">
                <div className="portal-role-title">{r.title}</div>
                <div className="portal-role-desc">{r.desc}</div>
              </div>
              <ChevronRight size={18} className="portal-role-arrow" />
            </button>
          ))}
        </div>

        <p className="auth-switch" style={{ marginTop: 20 }}>
          New company? <Link to="/register-company" className="auth-link">Get Started</Link> · Employee/Driver? <Link to="/employee-login" className="auth-link">Employee login</Link>
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14, fontSize: 13, color: '#94a3b8' }}>
          <Link to="/forgot-password" className="auth-link" style={{ fontSize: 13 }}>Forgot password?</Link>
          <span>|</span>
          <Link to="/admin/login" className="auth-link" style={{ fontSize: 13 }}><LogIn size={13} /> Admin portal</Link>
          <span>|</span>
          <Link to="/owner" className="auth-link" style={{ fontSize: 13 }}>Owner console</Link>
        </div>
      </div>
    </div>
  );
}