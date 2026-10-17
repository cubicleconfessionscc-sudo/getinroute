import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPinned, ShieldCheck, BellRing, Route, Users, Truck, LogIn, UserPlus, Zap, Clock, ChevronRight,
  Building2, User, Download, Smartphone, School, Menu, X, CarFront, BarChart3, Sparkles, Wallet,
  Gauge, Siren, MoonStar, HelpCircle, LifeBuoy, MessageCircle, MapPin, Navigation, ShieldAlert,
  RadioTower, AlertTriangle, BrainCircuit, Repeat, Activity, Radar, Target, CheckCircle2, ArrowRight
} from 'lucide-react';
import { APP_LINKS, APP_CONFIG, SHIPPED_APPS, androidOf, iosOf, RELEASE_VERSION } from '../config/apps';

const APP_BY_KEY = Object.fromEntries(APP_LINKS.map((a) => [a.key, a]));

const NAV = [
  { label: 'Home', id: 'top' },
  { label: 'Platform', id: 'platform' },
  { label: 'Solutions', id: 'solutions' },
  { label: 'Features', id: 'features' },
  { label: 'Apps', id: 'apps' },
  { label: 'Safety', id: 'safety' },
  { label: 'AI', id: 'ai' },
  { label: 'About', id: 'about' },
  { label: 'Contact', id: 'contact' }
];

const PLATFORM_FEATURES = [
  { icon: <Truck size={24} />, title: 'Live Fleet Tracking', text: 'Know where every vehicle is from the first pickup to the final drop on one interactive live map.' },
  { icon: <Route size={24} />, title: 'Intelligent Routes', text: 'Unlimited stops, pickup/drop sequencing, per-route speed limits and smart route planning.' },
  { icon: <Users size={24} />, title: 'Driver Management', text: 'Complete driver lifecycle — onboarding, documents, compliance, availability and performance.' },
  { icon: <ShieldCheck size={24} />, title: 'Safety & SOS', text: 'One-tap SOS with live GPS, SafeDrop, geofencing, overspeed and route-deviation alerts.' },
  { icon: <BrainCircuit size={24} />, title: 'Predictive Intelligence', text: 'Predicted ETA, no-show, demand and utilization forecasts that help operators act early.' },
  { icon: <Repeat size={24} />, title: 'Intelligent Automation', text: 'Events become actions automatically — incidents, recommendations, escalations and alerts.' },
  { icon: <Activity size={24} />, title: 'Analytics & Reports', text: 'Utilization, cost, check-in logs and exportable reports across the whole operation.' },
  { icon: <Building2 size={24} />, title: 'Vendor Management', text: 'Scoped portals for transport partners — fleets, drivers, trips and billing from one system.' },
  { icon: <Wallet size={24} />, title: 'Enterprise Billing', text: 'Transparent billing and payment verification with a clear subscription lifecycle.' },
  { icon: <Radar size={24} />, title: 'Real-Time Operations', text: 'Socket-powered live updates — tracking, chat, alerts and events reach the right person instantly.' },
  { icon: <Target size={24} />, title: 'Command Center', text: 'A single pane for active trips, vehicles, drivers, delays, incidents and AI recommendations.' },
  { icon: <Gauge size={24} />, title: 'Every Platform', text: 'Admin, employee, driver, parent and school experiences from one connected system.' }
];

const SOLUTIONS = [
  { icon: <Building2 size={30} />, title: 'Corporate', text: 'End-to-end employee transportation for companies of every size.', cta: 'Explore for Companies', to: '/register-company' },
  { icon: <Users size={30} />, title: 'Employee Transport', text: 'Bookings, live tracking, safety confirmation and support in every journey.', cta: 'Employee Experience', to: '/employee-login' },
  { icon: <School size={30} />, title: 'School Transport', text: 'Student transportation with parent visibility, attendance and safe drops.', cta: 'Explore for Schools', to: '/register-company' },
  { icon: <Truck size={30} />, title: 'Fleet Management', text: 'Vehicles, drivers, route allocation and compliance in one command center.', cta: 'Explore Fleet Tools', to: '/vendor/login' }
];

const AUTOMATION_FLOW = ['MANUAL', 'DETECT', 'RECOMMEND', 'APPROVE', 'AUTOMATE', 'MONITOR', 'RECOVER'];

const AI_FEATURES = [
  { icon: <Clock size={20} />, title: 'Predictive ETA', text: 'Live arrival estimates for every stop based on schedule and journey progress.' },
  { icon: <Route size={20} />, title: 'Smart Routing', text: 'Route optimization that keeps pickup and drop times intact.' },
  { icon: <User size={20} />, title: 'Driver Allocation', text: 'Best-driver matching informed by capacity, availability and history.' },
  { icon: <Truck size={20} />, title: 'Vehicle Allocation', text: 'Right-size vehicles to expected demand, capacity and route load.' },
  { icon: <BarChart3 size={20} />, title: 'Demand Prediction', text: 'Per-route, per-date ridership forecasts to plan fleet capacity.' },
  { icon: <ShieldAlert size={20} />, title: 'No-Show Prediction', text: 'Flag likely no-shows early so allocations can adjust.' },
  { icon: <Gauge size={20} />, title: 'Safety Intelligence', text: 'Risk scoring that focuses teams on what matters most first.' },
  { icon: <Wallet size={20} />, title: 'Cost Intelligence', text: 'Cost and utilization insight to keep the operation efficient.' },
  { icon: <Sparkles size={20} />, title: 'Operational Recommendations', text: 'Concrete, explainable recommends — with human approval before action.' }
];

const SAFETY_FEATURES = [
  { title: 'One-tap SOS', text: 'Emergency alert with live GPS position to admin and security immediately.' },
  { title: 'Live Tracking', text: 'Every employee and every stop watched in real time on a live map.' },
  { title: 'Route Deviation', text: 'Any vehicle leaving the planned route is flagged to operations instantly.' },
  { title: 'Overspeed Detection', text: 'Instant alerts when drivers exceed per-route speed limits.' },
  { title: 'Geofencing', text: 'Automatic arrival, departure and zone-boundary detection.' },
  { title: 'Emergency Escalation', text: 'Every safety event becomes a tracked incident with priority scoring and resolution flow.' },
  { title: 'Driver Safety', text: 'Verified drivers, document checks and compliance before the first trip.' },
  { title: 'Employee Safety', text: 'SafeDrop confirmation, night-shift protocols and escort support built in.' },
  { title: 'Incident Management', text: 'A full state machine turning events into resolved, audited incidents.' }
];

const ANALYTICS_FEATURES = [
  { icon: <BarChart3 size={22} />, title: 'Utilization', text: 'Vehicle utilization across routes, days and shifts.' },
  { icon: <Wallet size={22} />, title: 'Cost Insights', text: 'Transparent operating cost per trip, per route and per employee.' },
  { icon: <Activity size={22} />, title: 'Operational Load', text: 'Trips, check-ins, no-shows and cancellations at a glance.' },
  { icon: <Download size={22} />, title: 'Exports', text: 'Raw operational data exportable whenever you need it.' }
];

const INDUSTRIES = [
  'IT & Tech Parks', 'BPO & Contact Centres', 'Manufacturing', 'Healthcare & Hospitals', 'Banking & Finance', 'Retail & E-commerce', 'Colleges & Universities', 'K-12 Schools'
];

const FAQ = [
  { q: 'What is GetInRoute?', a: 'GetInRoute is an intelligent employee transportation operating system. It connects companies, employees, drivers, vehicles and routes into one platform with live tracking, safety, automation and predictive intelligence.' },
  { q: 'How does the 10-day trial work?', a: 'Register your company, submit a few details, owner approval is given, and a 10-day free trial begins with full platform access. Payment is required only after the trial ends.' },
  { q: 'Which apps are available?', a: 'The Employee, Driver and School Android apps are available now as direct APK downloads. The Parent app is in active development — no placeholder links, only real builds.' },
  { q: 'Is GetInRoute compliant with India\'s OSH Rules 2026?', a: 'Yes. GetInRoute includes GPS tracking for night-shift vehicles, driver background verification, trip documentation, SOS alerts, escort protocols, and audit-ready reporting.' },
  { q: 'Does it support multiple transport vendors?', a: 'Yes. Unlimited vendors, each with their own drivers, vehicles and zone assignments, all managed separately from the dispatch dashboard.' },
  { q: 'How is it different from generic cab-tracking tools?', a: 'GetInRoute is built for transportation operations — booking, boarding, safety, automation, intelligence and billing combined, with no per-employee module upsells.' }
];

const TRUST = [
  { icon: <MapPinned size={16} />, text: 'Real-time tracking' },
  { icon: <ShieldCheck size={16} />, text: 'Secure & audited' },
  { icon: <Building2 size={16} />, text: 'Multi-company' },
  { icon: <Sparkles size={16} />, text: 'AI-assisted decisions' },
  { icon: <AlertTriangle size={16} />, text: 'Safety-first design' },
  { icon: <Activity size={16} />, text: 'Scalable' },
  { icon: <Target size={16} />, text: 'Enterprise-ready' }
];

const CONTACT_CATEGORIES = [
  { icon: <Building2 size={22} />, title: 'Company enquiry', subject: 'Company enquiry' },
  { icon: <School size={22} />, title: 'School enquiry', subject: 'School enquiry' },
  { icon: <Truck size={22} />, title: 'Vendor enquiry', subject: 'Vendor enquiry' },
  { icon: <Smartphone size={22} />, title: 'App support', subject: 'App support' },
  { icon: <LifeBuoy size={22} />, title: 'Technical support', subject: 'Technical support' },
  { icon: <Users size={22} />, title: 'Partnership', subject: 'Partnership' }
];

const DEMO_KPIS = [
  { num: '24', label: 'Vehicles' },
  { num: '18', label: 'On Route' },
  { num: '3', label: 'Delayed' },
  { num: '1', label: 'Incident' },
  { num: '2', label: 'Alerts' }
];

const QUICK_ACCESS = [
  { icon: <Building2 size={24} />, title: 'Manage Transportation', sub: 'For Companies', to: '/register-company' },
  { icon: <School size={24} />, title: 'Manage School Transport', sub: 'For Schools', to: '/register-company' },
  { icon: <Truck size={24} />, title: 'Manage Fleet', sub: 'For Vendors', to: '/vendor/login' },
  { icon: <Users size={24} />, title: 'Track My Ride', sub: 'For Employees', to: '/employee-login' },
  { icon: <Navigation size={24} />, title: 'Manage My Trip', sub: 'For Drivers', to: '/driver-login' },
  { icon: <School size={24} />, title: 'Track My Child', sub: 'For Parents', to: '/parent/register' }
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', category: 'General', message: '' });
  const headRef = useRef(null);

  const go = (id) => {
    setMenuOpen(false);
    setHelpOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', id && id !== 'top' ? `/#${id}` : '/');
  };

  useEffect(() => {
    const id = window.location.hash ? window.location.hash.slice(1) : null;
    if (id) {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = document.querySelectorAll([
      '.pub-card', '.pub-app-chip', '.demo-row', '.demo-box',
      '.pub-kpi', '.pub-demo-card', '.founder-card', '.pub-hero-visual',
      '.live-dashboard-preview', '.pub-callout', '.pub-faq'
    ].join(','));
    if (!els.length) return;
    const clean = [];
    els.forEach((el) => {
      let raf = 0;
      const move = (e) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const rx = (0.5 - py) * 9;
        const ry = (px - 0.5) * 9;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(8px)`;
          el.style.setProperty('--tilt-x', `${((px - 0.5) * 22).toFixed(1)}px`);
          el.style.setProperty('--tilt-y', `${((py - 0.5) * 22).toFixed(1)}px`);
        });
      };
      const leave = () => {
        cancelAnimationFrame(raf);
        el.style.transform = '';
        el.style.setProperty('--tilt-x', '0px');
        el.style.setProperty('--tilt-y', '0px');
      };
      el.addEventListener('mousemove', move);
      el.addEventListener('mouseleave', leave);
      clean.push(() => { el.removeEventListener('mousemove', move); el.removeEventListener('mouseleave', leave); });
    });
    return () => clean.forEach((fn) => fn());
  }, []);

  const mailtoHref = () => {
    const s = encodeURIComponent(`GetInRoute enquiry — ${contactForm.category}${contactForm.name ? ` (${contactForm.name})` : ''}\n${contactForm.message}`);
    return `mailto:getinroute0@gmail.com?subject=${encodeURIComponent(contactForm.category)}&body=${s}`;
  };

  return (
    <div className="landing">
      {/* ================= TOP NAV ================= */}
      <header className="pub-nav" ref={headRef}>
        <Link to="/" className="pub-logo" aria-label="GetInRoute home">GetInRoute<span className="grad-text">.</span></Link>
        <nav className="pub-links" aria-label="Primary">
          {NAV.map((n) => (
            <button key={n.id} type="button" className="pub-link" onClick={() => go(n.id)}>{n.label}</button>
          ))}
        </nav>
        <div className="pub-nav-cta">
          <Link to="/login" className="btn btn-sm pub-login"><LogIn size={15} /> Login</Link>
          <a className="request-demo" href="#contact" onClick={(e) => { e.preventDefault(); go('contact'); }}>Request Demo</a>
        </div>
        <button className="pub-burger" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        {menuOpen && (
          <div className="pub-mobile" role="menu">
            {NAV.map((n) => (
              <button key={n.id} type="button" onClick={() => go(n.id)}>{n.label}</button>
            ))}
            <Link to="/login" onClick={() => setMenuOpen(false)}><LogIn size={15} /> Login</Link>
            <Link to="/register-company" onClick={() => setMenuOpen(false)}><UserPlus size={15} /> Request Demo</Link>
          </div>
        )}
      </header>

      {/* ================= HERO ================= */}
      <section className="hero pub-hero" id="top">
        <div className="pub-hero-grid">
          <div>
            <p className="pub-eyebrow"><span className="dot-pulse" /> Intelligent Employee Transportation — GetInRoute</p>
            <h1>
              Intelligent Employee Transportation.<br />
              <span className="grad-text">Powered by AI.</span>&nbsp;Designed for Safety.<br />
              Built for Operations.
            </h1>
            <p className="pub-hero-desc">
              GetInRoute helps companies manage employees, drivers, vehicles, routes and transportation operations from one intelligent platform.
            </p>
            <div className="hero-btns" style={{ justifyContent: 'flex-start' }}>
              <a className="btn btn-primary" href="#contact" onClick={(e) => { e.preventDefault(); go('contact'); }}><UserPlus size={17} /> Request a Demo</a>
              <button type="button" className="btn" style={{ background: 'rgba(255,255,255,.06)', color: '#e2f3ff', border: '1px solid rgba(255,255,255,.15)' }} onClick={() => go('platform')}>Explore Platform</button>
              <Link to="/apps" className="btn" style={{ background: 'rgba(14,165,233,.15)', color: '#7dd3fc', border: '1px solid rgba(14,165,233,.35)' }}><Download size={17} /> Download Apps</Link>
            </div>
          </div>
          <div className="pub-hero-visual" aria-hidden="true">
            {/* Admin Command Center visualization (illustrative, no fake data) */}
            <div className="live-dashboard-preview">
              <div className="live-dash-head">
                <span className="live-dot" /> <span className="live-dash-title">Command Center — illustrative live view</span>
              </div>
              <div className="live-map-placeholder">
                <svg viewBox="0 0 400 160" width="400" height="160" fill="none">
                  <path d="M20 140 C 70 110, 60 60, 120 60 S 240 30, 260 70 S 340 20, 380 20" stroke="#22d3ee" strokeWidth="2.5" strokeDasharray="5 7" />
                  <circle cx="20" cy="140" r="6" fill="#0b1120" stroke="#22d3ee" strokeWidth="2" />
                  <circle cx="120" cy="60" r="5" fill="#0b1120" stroke="#f59e0b" strokeWidth="2" />
                  <circle cx="260" cy="70" r="5" fill="#0b1120" stroke="#22d3ee" strokeWidth="2" />
                  <circle cx="380" cy="20" r="6" fill="#0b1120" stroke="#10b981" strokeWidth="2" />
                  <circle cx="80" cy="120" r="4" fill="#ef4444" />
                  <circle cx="300" cy="45" r="4" fill="#22d3ee" />
                </svg>
              </div>
              <div className="live-stat-row">
                <div className="live-stat"><div className="live-stat-num">Live</div><div className="live-stat-lbl">Trips</div></div>
                <div className="live-stat"><div className="live-stat-num">ETA</div><div className="live-stat-lbl">Alerts</div></div>
                <div className="live-stat"><div className="live-stat-num">AI</div><div className="live-stat-lbl">Recommendations</div></div>
                <div className="live-stat"><div className="live-stat-num">Safe</div><div className="live-stat-lbl">Status</div></div>
              </div>
            </div>
            <div className="route-card">
              <div className="rc-head">
                <span className="rc-code">TRIP · GR-2481</span>
                <span className="rc-pill"><span className="dot-pulse" /> On route</span>
              </div>
              <svg className="route-svg" viewBox="0 0 340 220" fill="none" role="presentation">
                <path className="route-path-bg" d="M30 190 C 80 150, 60 90, 120 80 S 220 40, 250 90 S 300 40, 310 30" strokeLinecap="round" />
                <path className="route-path" d="M30 190 C 80 150, 60 90, 120 80 S 220 40, 250 90 S 300 40, 310 30" strokeLinecap="round" />
                <circle className="stop-dot start" cx="30" cy="190" r="6" />
                <circle className="stop-dot" cx="120" cy="80" r="4.5" />
                <circle className="stop-dot" cx="250" cy="90" r="4.5" />
                <circle className="stop-dot end" cx="310" cy="30" r="6" />
                <g className="mover">
                  <circle r="6" fill="#f5f7ff" stroke="#0ea5e9" strokeWidth="2.5">
                    <animateMotion dur="5s" repeatCount="indefinite" path="M30 190 C 80 150, 60 90, 120 80 S 220 40, 250 90 S 300 40, 310 30" />
                  </circle>
                </g>
              </svg>
              <div className="rc-foot">
                <div className="rf-item"><MapPin size={13} /><span className="rf-label">Pickup</span><span className="rf-value">Sector 12 Hub</span></div>
                <div className="rf-item"><MapPin size={13} /><span className="rf-label">Drop-off</span><span className="rf-value">Tech Park East</span></div>
                <div className="rf-item"><Clock size={13} /><span className="rf-label">ETA</span><span className="rf-value">08:42</span></div>
              </div>
            </div>
            <div className="rc-note">Journey visualization — routes are modelled from your real trips.</div>
          </div>
        </div>
        <div className="pub-trust">
          {TRUST.map((t, i) => <span key={i}>{t.icon} {t.text}</span>)}
        </div>
      </section>

      {/* ================= PLATFORM ================= */}
      <section className="pub-section" id="platform">
        <h2 className="pub-h2">GETINROUTE PLATFORM</h2>
        <p className="pub-sub">One operating system for employee transportation.</p>
        <div className="pub-grid-3" style={{ marginBottom: 28 }}>
          {SOLUTIONS.slice(0, 4).map((s, i) => (
            <div className="pub-card" key={i}>
              <div className="pub-card-ico ico-indigo">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <Link to={s.to} className="pub-cta">{s.cta} <ChevronRight size={16} /></Link>
            </div>
          ))}
        </div>
        <div className="pub-grid-3">
          {PLATFORM_FEATURES.map((f, i) => (
            <div className="pub-card" key={i}>
              <div className="pub-card-ico" style={{ background: 'rgba(14,165,233,.12)', color: '#38bdf8' }}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= SOLUTIONS ================= */}
      <section className="pub-section" id="solutions">
        <h2 className="pub-h2">BUILT FOR EVERYONE IN THE JOURNEY</h2>
        <p className="pub-sub">Admin command center, employee, driver, parent and school experiences — all connected.</p>
        <div className="pub-grid-3">
          <div className="pub-card"><div className="pub-card-ico ico-indigo"><ShieldCheck size={22} /></div><h3>Admin</h3><p>Transportation command center — trips, vehicles, drivers, routes, alerts and AI from one dashboard.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-green"><Users size={22} /></div><h3>Employee</h3><p>Booking, trip tracking, notifications and safety in the palm of every employee.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-amber"><Navigation size={22} /></div><h3>Driver</h3><p>Trips, navigation, boarding, OTP verification, GPS reporting and on-road safety.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-violet"><School size={22} /></div><h3>Parent</h3><p>Student transport visibility, notifications, live tracking and safety confirmations.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-pink"><School size={22} /></div><h3>School</h3><p>Student transportation management with attendance, routes and safety for every journey.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-blue"><BarChart3 size={22} /></div><h3>Management</h3><p>Analytics, costs, utilization and intelligence for leadership oversight.</p></div>
        </div>
      </section>

      {/* ================= FEATURES ================= */}
      <section className="pub-section" id="features">
        <h2 className="pub-h2">ENTERPRISE FEATURES, COMPLETE CONTROL</h2>
        <p className="pub-sub">Every capability the operation needs — without switching tools.</p>
        <div className="pub-grid-3">
          <div className="pub-card"><div className="pub-card-ico ico-indigo"><Route size={22} /></div><h3>Route Management</h3><p>Unlimited stops, zones, sequences and per-route speed limits.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-green"><CheckCircle2 size={22} /></div><h3>Check-in / Check-out</h3><p>Swipe or OTP boarding with employee confirmation and no-show handling.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-violet"><MessageCircle size={22} /></div><h3>In-Trip Chat</h3><p>Drivers, employees and admins stay in sync through built-in messaging.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-amber"><LifeBuoy size={22} /></div><h3>Support Desk</h3><p>Tickets, comments, escalation and full lifecycle for driver and employee support.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-pink"><Wallet size={22} /></div><h3>Billing & Subscriptions</h3><p>Transparent rate plans, invoices and a clear subscription lifecycle.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-blue"><Gauge size={22} /></div><h3>Speed & Compliance</h3><p>Live speed monitoring, driver verification and audit-ready trip records.</p></div>
        </div>
      </section>

      {/* ================= AI ================= */}
      <section className="pub-section" id="ai">
        <h2 className="pub-h2">INTELLIGENCE THAT DOESN'T JUST REPORT. IT PREDICTS.</h2>
        <p className="pub-sub">Predictions, recommendations and explainable insight — with human approval before any action.</p>
        <div className="pub-grid-3">
          {AI_FEATURES.map((f, i) => (
            <div className="pub-card" key={i}>
              <div className="pub-card-ico ico-violet">{f.icon}</div>
              <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: '10px 0 4px', color: 'var(--text)' }}>{f.title}</h3>
              <p style={{ fontSize: 13.5, color: 'var(--slate)', lineHeight: 1.55, margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
        <div className="pub-callout">
          <b>Reasoning in action</b>
          <p>Driver unavailable → Detects → Checks alternatives → Validates safety → Predicts impact → Recommends replacement → Requests approval → Reassigns → Notifies employees → Monitors the result.</p>
        </div>
      </section>

      {/* ================= AUTOMATION ================= */}
      <section className="pub-section" id="automation">
        <h2 className="pub-h2">FROM MANUAL OPERATIONS TO INTELLIGENT AUTOMATION</h2>
        <p className="pub-sub">Companies control exactly how much automation they allow. Rules, events, actions — all audited.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 28 }}>
          {AUTOMATION_FLOW.map((step, i) => (
            <React.Fragment key={i}>
              <span className="chip" style={{ background: i % 2 === 0 ? 'rgba(14,165,233,.14)' : 'rgba(129,140,248,.14)', color: i % 2 === 0 ? '#7dd3fc' : '#a5b4fc', fontSize: 13, padding: '8px 14px' }}>{step}</span>
              {i < AUTOMATION_FLOW.length - 1 && <ArrowRight size={16} style={{ color: 'var(--violet)' }} />}
            </React.Fragment>
          ))}
        </div>
        <div className="pub-grid-3">
          <div className="pub-card"><div className="pub-card-ico ico-indigo"><RadioTower size={22} /></div><h3>Event Engine</h3><p>SOS, overspeed, geofence and trip events flow into one auditable stream.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-green"><Target size={22} /></div><h3>Rule Engine</h3><p>Platform or per-company rules decide what each event triggers.</p></div>
          <div className="pub-card"><div className="pub-card-ico ico-violet"><Zap size={22} /></div><h3>Actions</h3><p>Incidents, recommendations, escalations and notifications — each logged and reversible.</p></div>
        </div>
      </section>

      {/* ================= SAFETY ================= */}
      <section className="pub-section" id="safety">
        <h2 className="pub-h2"><ShieldCheck size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />SAFETY COMES BEFORE OPTIMIZATION.</h2>
        <p className="pub-sub">Every journey is watched. Every risk is surfaced. Every event becomes a resolved, audited incident.</p>
        <div className="pub-grid-3">
          {SAFETY_FEATURES.map((f, i) => (
            <div className="pub-card" key={i}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>{f.title}</h3>
              <p style={{ fontSize: 13.5, color: 'var(--slate)', lineHeight: 1.55, margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= APPS ================= */}
      <section className="pub-section" id="apps">
        <h2 className="pub-h2">ONE PLATFORM. EVERY JOURNEY.</h2>
        <p className="pub-sub">Employee, Driver, Parent, School and Admin — one connected experience.</p>
        <div className="pub-apps-row" style={{ marginBottom: 18 }}>
          {APP_CONFIG.map((raw) => {
            const android = androidOf(raw);
            const ios = iosOf(raw);
            return (
              <Link to="/apps" className="pub-app-chip" key={raw.key}>
                <div className="pub-card-ico ico-indigo">{raw.key === 'school' ? <School size={22} /> : raw.key === 'driver' ? <Navigation size={22} /> : raw.key === 'parent' ? <Users size={22} /> : <Smartphone size={22} />}</div>
                <div>
                  <b>{raw.shortName} App</b>
                  <div className="pub-a">
                    {android.available ? `Android APK · v${RELEASE_VERSION}` : 'Android: coming soon'}
                    {' · '}
                    {ios.available ? 'iPhone: App Store' : 'iPhone: coming soon'}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {SHIPPED_APPS.map((raw) => {
            const app = APP_BY_KEY[raw.key];
            const android = androidOf(raw);
            if (!android.available) return null;
            return (
              <a
                key={raw.key}
                className="btn btn-primary"
                href={android.url}
                download={`${app.name.replace(/\s+/g, '')}-v${RELEASE_VERSION}.apk`}
              >
                <Download size={17} /> {raw.shortName} APK
              </a>
            );
          })}
          <Link to="/apps" className="btn btn-ghost"><Smartphone size={17} /> All Apps</Link>
        </div>
        <p className="pub-muted-note" style={{ textAlign: 'center', marginTop: 14 }}>
          Android APKs install directly. iPhone builds ship through the Apple App Store / TestFlight &mdash;
          the button activates automatically once each listing is live. No placeholder links are published.
        </p>
      </section>

      {/* ================= COMMAND CENTER ================= */}
      <section className="pub-section" id="demo">
        <h2 className="pub-h2">COMMAND CENTER IN ACTION</h2>
        <div className="pub-demo-tag"><AlertTriangle size={14} /> Illustrative preview — not real platform statistics</div>
        <div className="pub-kpis">
          {DEMO_KPIS.map((k, i) => (
            <div className="pub-kpi" key={i}>
              <div className="pub-kpi-num">{k.num}</div>
              <div className="pub-kpi-lbl">{k.label}</div>
            </div>
          ))}
        </div>
        <div className="pub-demo-grid">
          <div className="pub-demo-card">
            <h3>Route status</h3>
            <ul className="pub-demo-list">
              <li><span className="pub-dot green" /> Line A — on time, 4 stops left</li>
              <li><span className="pub-dot green" /> Line B — on time, boarding</li>
              <li><span className="pub-dot amber" /> Line C — delayed 9 min</li>
              <li><span className="pub-dot green" /> Line D — completed</li>
            </ul>
          </div>
          <div className="pub-demo-card">
            <h3>Incident feed <span className="pub-demo-badge">P1</span></h3>
            <ul className="pub-demo-list">
              <li><Siren size={14} /> SOS alert — vehicle GR-2481, Line C</li>
              <li><AlertTriangle size={14} /> Overspeed — Tech Park East</li>
              <li><RadioTower size={14} /> Route deviation — Line F</li>
            </ul>
          </div>
          <div className="pub-demo-card">
            <h3>AI predictions</h3>
            <ul className="pub-demo-list">
              <li><Sparkles size={14} /> No-show risk: 2 riders flagged</li>
              <li><Sparkles size={14} /> Utilization forecast: 82% Line A</li>
              <li><Sparkles size={14} /> Demand: +14% expected tomorrow</li>
            </ul>
          </div>
          <div className="pub-demo-card">
            <h3>Automation activity</h3>
            <ul className="pub-demo-list">
              <li><Repeat size={14} /> 3 incidents auto-created</li>
              <li><Zap size={14} /> 2 recommendations approved</li>
              <li><MessageCircle size={14} /> 12 notifications delivered</li>
            </ul>
          </div>
        </div>
        <div className="pub-demo-note">AI recommends. Operators decide. This preview is illustrative only.</div>
      </section>

      {/* ================= ANALYTICS ================= */}
      <section className="pub-section" id="analytics">
        <h2 className="pub-h2">ANALYTICS FOR LEADERSHIP</h2>
        <p className="pub-sub">Understand the whole operation — cost, load and utilization — with real data.</p>
        <div className="pub-grid-3">
          {ANALYTICS_FEATURES.map((f, i) => (
            <div className="pub-card" key={i}>
              <div className="pub-card-ico ico-blue">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================= INDUSTRIES ================= */}
      <div id="about" style={{ position: 'relative', top: -78 }} aria-hidden="true" />
      <section className="pub-section" id="industries">
        <h2 className="pub-h2">BUILT FOR EVERY OPERATION</h2>
        <p className="pub-sub">GetInRoute adapts to the way your organization moves.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 780, margin: '0 auto' }}>
          {INDUSTRIES.map((ind, i) => (
            <span key={i} className="chip" style={{ background: 'rgba(14,165,233,.06)', borderRadius: 12, padding: '9px 16px', fontSize: 13.5 }}>{ind}</span>
          ))}
        </div>
      </section>

      {/* ================= TRIAL / CTA ================= */}
      <section className="pub-section" id="trial">
        <div className="pub-trial">
          <h2>Try GetInRoute for 10 Days</h2>
          <p>A simple path from registration to a full working trial — with a human verifying every step.</p>
          <ul className="pub-trial-list">
            <li><ShieldCheck size={16} /> No upfront payment</li>
            <li><Clock size={16} /> Trial requires owner approval</li>
            <li><Sparkles size={16} /> Full platform access during the approved trial</li>
            <li><Wallet size={16} /> Payment required only after the trial ends</li>
            <li><LifeBuoy size={16} /> Payment verification is manual initially</li>
          </ul>
          <Link to="/register-company" className="btn btn-primary" style={{ justifyContent: 'center', minWidth: 220, marginTop: 8 }}><UserPlus size={17} /> Request Demo</Link>
        </div>
      </section>

      {/* ================= FOUNDER ================= */}
      <section style={{ padding: '60px 20px', maxWidth: 800, margin: '0 auto' }} id="founder">
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 36 }}>
          <User size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Meet the Founder
        </h2>
        <div className="founder-card" style={{ background: 'var(--card)', borderRadius: 18, padding: '40px 36px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <div className="founder-photo-wrap">
            <img className="founder-photo" src="/assets/edwin-peroli.jpg" alt="C Edwin Peroli — Founder, GetInRoute" />
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: 'var(--text)' }}>C Edwin Peroli</h3>
            <p style={{ fontSize: 14, color: 'var(--accent)', margin: 0, fontWeight: 600 }}>Founder, GetInRoute</p>
          </div>
          <p style={{ fontSize: 15, color: 'var(--slate)', lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            Founder and product creator of GetInRoute. Built the platform from the ground up to solve the real problems companies face managing employee transport — missed cabs, unsafe night shifts, no visibility, and expensive vendor tools.
          </p>
          <p style={{ fontSize: 15, color: 'var(--slate)', lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            “Building a smarter, safer and more intelligent future for employee transportation.”
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <div style={{ background: 'rgba(14,165,233,.12)', borderRadius: 10, padding: '8px 16px', fontSize: 13, color: '#7dd3fc', fontWeight: 600 }}>
              <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Independent technology company
            </div>
            <div style={{ background: 'rgba(16,185,129,.12)', borderRadius: 10, padding: '8px 16px', fontSize: 13, color: '#34d399', fontWeight: 600 }}>
              <MapPinned size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Building for India
            </div>
          </div>
        </div>
      </section>

      {/* ================= DEMO ACCOUNTS ================= */}
      <section className="demo-box">
        <h2>Try it right now</h2>
        <p>Login as admin, employee, or driver with the demo accounts.</p>
        <div className="demo-rows">
          <div className="demo-row"><code>Admin</code> <span className="sp">admin@getinroute.com</span> <code>Admin@123</code></div>
          <div className="demo-row"><code>Employee</code> <span className="sp">E1001</span> <code>Emp@123</code></div>
          <div className="demo-row"><code>Driver</code> <span className="sp">D2001</span> <code>Drive@123</code></div>
        </div>
        <Link to="/login" className="btn btn-primary" style={{ marginTop: 18 }}><LogIn size={16} /> Choose a portal to log in</Link>
      </section>

      {/* ================= FAQ ================= */}
      <section className="pub-section" id="faq" style={{ maxWidth: 760 }}>
        <h2 className="pub-h2">Frequently Asked Questions</h2>
        {FAQ.map((item, i) => (
          <details key={i} className="pub-faq">
            <summary>{item.q}<ChevronRight size={18} /></summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

      {/* ================= CONTACT ================= */}
      <section className="pub-section" id="contact" style={{ maxWidth: 900 }}>
        <h2 className="pub-h2">Request a Demo</h2>
        <p className="pub-sub">Reach the right team directly — a human reads every message.</p>
        <div className="pub-grid-3">
          {CONTACT_CATEGORIES.map((c, i) => (
            <a key={i} className="pub-card pub-access" href={`mailto:getinroute0@gmail.com?subject=${encodeURIComponent(c.subject)}`}>
              <div className="pub-card-ico ico-indigo">{c.icon}</div>
              <h3>{c.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>getinroute0@gmail.com</p>
            </a>
          ))}
        </div>
        <div className="pub-contact-form">
          <h3 style={{ marginBottom: 12 }}>Send a message</h3>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="field"><label>Name</label><input aria-label="Name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} /></div>
            <div className="field"><label>Category</label>
              <select aria-label="Category" value={contactForm.category} onChange={(e) => setContactForm({ ...contactForm, category: e.target.value })}>
                {CONTACT_CATEGORIES.map((c, i) => <option key={i}>{c.title}</option>)}
                <option>General</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}><label>Message</label><textarea rows={4} aria-label="Message" value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} /></div>
          <a className="btn btn-primary" style={{ justifyContent: 'center' }} href={mailtoHref()}>Request Demo via email</a>
          <p className="pub-muted-note">Opens your email app addressed to getinroute0@gmail.com. No fake forms, no lost messages.</p>
        </div>
      </section>

      {/* ================= SEO TEXT ================= */}
      <section className="pub-section" style={{ maxWidth: 800, opacity: .85 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>About GetInRoute — Intelligent Employee Transportation Management</h2>
        <p style={{ fontSize: 14, color: 'var(--slate)', lineHeight: 1.7 }}>
          GetInRoute is an intelligent employee transportation management platform for Indian companies. It replaces manual cab scheduling, phone-based driver coordination, and paper attendance registers with a single digital operating system. Admins manage routes, allocate cabs, track drivers on a live map, and monitor speed from one dashboard. Employees book trips, check in and out with OTP, and confirm they reached home safely. Drivers follow GPS-optimized routes and report trip status in real time, and parents and schools stay connected to every student journey.
        </p>
        <p style={{ fontSize: 14, color: 'var(--slate)', lineHeight: 1.7, marginTop: 12 }}>
          GetInRoute includes live fleet tracking, intelligent routing, driver and vehicle management, safety and SOS, geofencing, overspeed monitoring, incident management, in-trip chat, automation, and predictive intelligence for no-shows, demand, utilization and ETA. The platform is cloud-hosted, uses React for web, Expo and React Native for mobile apps, Node.js and Express for the backend, and OpenStreetMap for all maps. It operates on a transparent flat monthly price with no per-employee, per-vehicle or module upsells.
        </p>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="pub-footer">
        <div className="pub-footer-grid">
          <div className="pub-footer-brand">
            <div className="pub-logo">GetInRoute<span className="grad-text">.</span></div>
            <p>Smarter routes. Safer journeys. Intelligent transportation operations.</p>
          </div>
          <div className="pub-footer-col">
            <h4>Platform</h4>
            <button onClick={() => go('platform')}>Platform</button>
            <button onClick={() => go('platform')}>Live Tracking</button>
            <button onClick={() => go('platform')}>Route Intelligence</button>
            <button onClick={() => go('automation')}>Automation</button>
            <button onClick={() => go('safety')}>Safety</button>
            <button onClick={() => go('ai')}>AI</button>
          </div>
          <div className="pub-footer-col">
            <h4>Solutions</h4>
            <Link to="/register-company">Companies</Link>
            <Link to="/register-company">Schools</Link>
            <Link to="/vendor/login">Vendors</Link>
            <Link to="/employee-login">Employees</Link>
            <Link to="/driver-login">Drivers</Link>
            <Link to="/parent/register">Parents</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Apps</h4>
            <Link to="/apps">Employee</Link>
            <Link to="/apps">Driver</Link>
            <Link to="/apps">Parent</Link>
            <Link to="/apps">School</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Access</h4>
            <Link to="/admin/login">Admin</Link>
            <Link to="/company/login">Company</Link>
            <Link to="/vendor/login">Vendor</Link>
            <Link to="/school/login">School</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Company</h4>
            <button onClick={() => go('about')}>About</button>
            <button onClick={() => go('founder')}>Founder</button>
            <button onClick={() => go('contact')}>Contact</button>
          </div>
          <div className="pub-footer-col">
            <h4>Support</h4>
            <button onClick={() => go('faq')}>Help</button>
            <Link to="/apps">App Support</Link>
          </div>
          <div className="pub-footer-col">
            <h4>Legal</h4>
            <span>Privacy</span>
            <span>Terms</span>
            <span>Security</span>
          </div>
        </div>
        <div className="pub-footer-bottom">© {new Date().getFullYear()} GetInRoute — An intelligent employee transportation operating system.</div>
      </footer>

      {/* ================= SUPPORT FLOAT ================= */}
      <div className="pub-help">
        {helpOpen && (
          <div className="pub-help-panel" role="menu" aria-label="GetInRoute Help">
            <div className="pub-help-head"><MessageCircle size={16} /> GetInRoute Help</div>
            <button onClick={() => go('faq')}><HelpCircle size={15} /> Help Center</button>
            <button onClick={() => go('contact')}><LifeBuoy size={15} /> Contact Support</button>
            <a href={mailtoHref()} onClick={() => setHelpOpen(false)}><AlertTriangle size={15} /> Report an Issue</a>
            <Link to="/apps" onClick={() => setHelpOpen(false)}><Smartphone size={15} /> App Support</Link>
          </div>
        )}
        <button className="pub-help-btn" aria-label="GetInRoute Help" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
          <MessageCircle size={20} />
        </button>
      </div>
    </div>
  );
}