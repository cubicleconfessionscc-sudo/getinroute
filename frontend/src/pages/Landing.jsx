import React from 'react';
import { Link } from 'react-router-dom';
import { MapPinned, ShieldCheck, BellRing, Route, Users, Truck, LogIn, UserPlus, Zap, Clock, Star, ChevronRight, Building2, User, Download, Smartphone, School, Apple } from 'lucide-react';

const FEATURES = [
  { icon: <MapPinned size={26} />, color: 'ico-indigo', title: 'Live Cab & Employee Tracking', text: 'Admin watches every cab and employee in real time on an interactive map — from the first pickup stop to the final drop.' },
  { icon: <BellRing size={26} />, color: 'ico-pink', title: 'Speed Limit Alerts', text: 'Set per-route speed limits. The moment a driver crosses the limit, the admin gets an instant notification.' },
  { icon: <Route size={26} />, color: 'ico-violet', title: 'Smart Route Editor', text: 'Design routes with any number of stops, pick-up/drop sequences, and assign unlimited employees and vehicles.' },
  { icon: <Users size={26} />, color: 'ico-green', title: 'Admin Approvals & Access Control', text: 'Every registration needs admin approval. Only you decide who gets in, who is scheduled, and what they can see.' },
  { icon: <Truck size={26} />, color: 'ico-amber', title: 'Vehicle & Trip Management', text: 'Allocate cabs to Lines 1–10 and Trips 1–2, update driver names, vehicle details, and phone numbers anytime.' },
  { icon: <ShieldCheck size={26} />, color: 'ico-blue', title: 'Check-in / Check-out + Feedback', text: 'Employees swipe to check in and out of the cab. Drivers see who boarded. Everyone rates each trip when it ends.' }
];

const SAFETY_FEATURES = [
  { title: 'SOS Emergency Alert', text: 'One-tap SOS button sends live GPS location and alerts to admin and security team instantly.' },
  { title: 'SafeDrop Confirmation', text: 'Employees confirm safe arrival home. If not confirmed within 30 minutes, admin gets notified.' },
  { title: 'Night-Hour Doorstep Drop', text: 'Female employees get mandatory doorstep drop for shifts after 9 PM with GPS-verified delivery.' },
  { title: 'Escort for Women', text: 'Admin assigns a dedicated escort for women employees on late-night cabs. Escort badge visible in-app.' },
  { title: 'Overspeed Monitoring', text: 'Real-time speed tracking with instant alerts when drivers exceed route speed limits.' },
  { title: 'Driver Background Checks', text: 'License verification, Aadhaar, phone validation, and face photo — all vetted before first trip.' }
];

const PRICING = [
  { name: 'Starter', price: '₹15,000', per: '/month', employees: 'Up to 200 employees', features: ['Live GPS tracking', 'Route management', 'Cab allotment', 'Employee & driver apps', 'Check-in / check-out', 'Basic reporting', 'Email support'] },
  { name: 'Professional', price: '₹30,000', per: '/month', employees: 'Up to 500 employees', features: ['Everything in Starter', 'Multi-vendor support', 'Speed monitoring', 'SafeDrop confirmation', 'SOS alerts', 'Night-hour drops', 'Priority support'], popular: true },
  { name: 'Enterprise', price: '₹60,000+', per: '/month', employees: '500+ employees', features: ['Everything in Professional', 'Unlimited vendors & zones', 'Escort management', 'Custom integrations', 'Dedicated account manager', 'SLA guarantee', 'Phone + on-site support'] }
];

const FAQ = [
  { q: 'What is GetInRoute?', a: 'GetInRoute is an employee transport management platform for Indian companies. It provides live cab tracking, route optimization, driver management, cab allotment, SOS emergency alerts, SafeDrop confirmation, and multi-vendor support — all in one web and mobile app.' },
  { q: 'How much does GetInRoute cost?', a: 'GetInRoute offers three pricing tiers: Starter (Rs.15,000/month for up to 200 employees), Professional (Rs.30,000/month for up to 500 employees), and Enterprise (Rs.60,000+/month for 500+ employees). Infrastructure costs start at just Rs.400/month.' },
  { q: 'Is GetInRoute compliant with OSH Rules 2026?', a: 'Yes. GetInRoute includes all features required by India\'s OSH Rules 2026: GPS tracking for night-shift vehicles, driver background verification, trip documentation, SOS alerts, female escort protocols, and audit-ready reporting.' },
  { q: 'Does GetInRoute support multiple transport vendors?', a: 'Yes. GetInRoute supports unlimited transport vendors, each with their own drivers, vehicles, and zone assignments. Admins can filter and manage vendors separately from the dispatch dashboard.' },
  { q: 'How does GetInRoute ensure employee safety?', a: 'GetInRoute provides multiple safety features: one-tap SOS emergency alerts with live GPS, SafeDrop confirmation (auto-alerts if not confirmed within 30 minutes), speed monitoring with overspeed alerts, night-hour doorstep drops, escort feature for women employees, and real-time cab tracking.' },
  { q: 'Can employees book cabs themselves?', a: 'Yes. Employees use the GetInRoute mobile app to request cabs by selecting pickup zone, destination, shift, and preferred timing. Admin approves the request and assigns a vehicle and driver.' },
  { q: 'Which cities does GetInRoute operate in?', a: 'GetInRoute works across India. It is a cloud-based platform — you can deploy it in any city. Setup takes less than 1 week. No hardware installation required.' },
  { q: 'How is GetInRoute different from MoveInSync or Routematic?', a: 'GetInRoute is significantly more affordable (starts at Rs.15,000/month vs Rs.3-10 per employee/month). It includes multi-vendor support, SafeDrop, SOS alerts, escort feature, and full cab allotment — all in the base plan. MoveInSync charges extra for each module.' }
];

export default function Landing() {
  return (
    <div className="landing">
      {/* TOP BAR */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', background: 'rgba(15,20,26,.9)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <Link to="/" style={{ textDecoration: 'none', color: '#fff', fontWeight: 800, fontSize: 18, letterSpacing: '.3px' }}>
          GetInRoute<span className="grad-text">.</span>
        </Link>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/login" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}><LogIn size={15} /> Admin Login</Link>
          <Link to="/vendor-login" className="btn btn-sm" style={{ textDecoration: 'none', background: 'rgba(124,58,237,.22)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,.45)' }}><Truck size={15} /> Vendor Login</Link>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <h1>GetInRoute<span className="grad-text">.</span></h1>
        <h2 style={{ margin: '8px 0 6px', fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800 }}>
          Employee cab tracking, <span className="grad-text">reimagined</span>
        </h2>
        <p>One platform for admin, employees, and drivers — route planning, live tracking, speed alerts, schedules, check-ins, and trip feedback.</p>
        <div className="hero-btns" style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
          <Link to="/login" className="btn btn-primary"><LogIn size={17} /> Admin Login</Link>
          <Link to="/vendor-login" className="btn" style={{ background: 'rgba(124,58,237,.22)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,.45)' }}><Truck size={17} /> Vendor Login</Link>
          <Link to="/employee-login" className="btn" style={{ background: 'rgba(16,185,129,.2)', color: '#10b981', border: '1px solid rgba(16,185,129,.4)' }}><Users size={17} /> Employee Login</Link>
          <Link to="/register" className="btn" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)' }}><UserPlus size={17} /> Register</Link>
          <Link to="/register-company" className="btn" style={{ background: 'rgba(124,58,237,.25)', color: '#a78bfa', border: '1px solid rgba(124,58,237,.4)' }}><Building2 size={17} /> Register Company</Link>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features">
        {FEATURES.map((f, i) => (
          <div className="feature" key={i}>
            <div className={`ico ${f.color}`} style={{ width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      {/* SAFETY SECTION */}
      <section style={{ padding: '60px 20px', maxWidth: 960, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 8 }}>
          <ShieldCheck size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Employee Safety & Compliance
        </h2>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.65)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.6 }}>
          GetInRoute is built for India's OSH Rules 2026. Every safety feature — SOS alerts, SafeDrop, night drops, escorts, speed monitoring — included in every plan.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {SAFETY_FEATURES.map((f, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: '24px 20px', border: '1px solid rgba(255,255,255,.08)' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.5, margin: 0 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: '60px 20px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 36 }}>
          How GetInRoute Works
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center' }}>
          {[
            { step: '1', title: 'Admin Sets Up Routes', text: 'Define zones, stops, shift timings, and speed limits. Assign employees to routes.' },
            { step: '2', title: 'Employees Request Cabs', text: 'Employees pick zone, destination, and shift. Admin approves and allocates vehicle + driver.' },
            { step: '3', title: 'Drivers Follow GPS Routes', text: 'Drivers see optimized stop sequence, navigate with Leaflet/OpenStreetMap, and mark arrivals.' },
            { step: '4', title: 'Admin Monitors Everything', text: 'Live map, speed alerts, check-in stats, trip history — all on one dashboard.' }
          ].map((s, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: '28px 24px', flex: '1 1 200px', maxWidth: 210, textAlign: 'center', border: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 22, background: 'linear-gradient(135deg, #6366f1, #ec4899)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>{s.step}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{s.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', margin: 0, lineHeight: 1.5 }}>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section style={{ padding: '60px 20px', maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 8 }}>
          Simple, Affordable Pricing
        </h2>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.65)', maxWidth: 500, margin: '0 auto 36px' }}>
          No per-employee fees. No hidden costs. One flat monthly price.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center' }}>
          {PRICING.map((p, i) => (
            <div key={i} style={{
              background: p.popular ? 'linear-gradient(135deg, rgba(99,102,241,.2), rgba(236,72,153,.15))' : 'rgba(255,255,255,.06)',
              borderRadius: 16, padding: '32px 24px', flex: '1 1 260px', maxWidth: 300, border: p.popular ? '2px solid #6366f1' : '1px solid rgba(255,255,255,.08)', position: 'relative'
            }}>
              {p.popular && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20 }}>MOST POPULAR</div>}
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{p.name}</h3>
              <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 2 }}>{p.price}<span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(255,255,255,.5)' }}>{p.per}</span></div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 16 }}>{p.employees}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {p.features.map((f, j) => (
                  <li key={j} style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#22c55e', fontSize: 14 }}>&#10003;</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '60px 20px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 36 }}>
          Frequently Asked Questions
        </h2>
        {FAQ.map((item, i) => (
          <details key={i} style={{ marginBottom: 12, background: 'rgba(255,255,255,.06)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden' }}>
            <summary style={{ padding: '16px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 15, listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {item.q}
              <ChevronRight size={18} style={{ transition: 'transform .2s' }} />
            </summary>
            <p style={{ padding: '0 20px 16px', fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.6, margin: 0 }}>{item.a}</p>
          </details>
        ))}
      </section>

      {/* FOUNDER */}
      <section style={{ padding: '60px 20px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 36 }}>
          <User size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Meet the Founder
        </h2>
        <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 18, padding: '40px 36px', border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 40, fontWeight: 800 }}>
            CEP
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>C Edwin Peroli</h3>
            <p style={{ fontSize: 14, color: '#a5b4fc', margin: 0, fontWeight: 600 }}>Founder & Builder</p>
          </div>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.65)', lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            Operational Specialist at Sagility, Bengaluru. Built GetInRoute from the ground up to solve the real problems companies face managing employee transport — missed cabs, unsafe night shifts, no visibility, and expensive vendor tools.
          </p>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.65)', lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            GetInRoute is designed to make corporate employee transportation affordable, safe, and easy to manage for companies of all sizes.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <div style={{ background: 'rgba(99,102,241,.15)', borderRadius: 10, padding: '8px 16px', fontSize: 13, color: '#a5b4fc', fontWeight: 600 }}>
              <Building2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Sagility, Bengaluru
            </div>
            <div style={{ background: 'rgba(16,185,129,.15)', borderRadius: 10, padding: '8px 16px', fontSize: 13, color: '#34d399', fontWeight: 600 }}>
              <MapPinned size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Building for India
            </div>
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section className="demo-box">
        <h2>Try it right now</h2>
        <p>Login as admin, employee, or driver with the demo accounts.</p>
        <div className="demo-rows">
          <div className="demo-row"><code>Admin</code> <span className="sp">admin@getinroute.com</span> <code>Admin@123</code></div>
          <div className="demo-row"><code>Employee</code> <span className="sp">E1001</span> <code>Emp@123</code></div>
          <div className="demo-row"><code>Driver</code> <span className="sp">D2001</span> <code>Drive@123</code></div>
        </div>
      </section>

      {/* DOWNLOAD THE APP */}
      <section style={{ padding: '60px 20px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, marginBottom: 8 }}>
          <Smartphone size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Download the GetInRoute App
        </h2>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.65)', maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.6 }}>
          Employees, drivers, and admins get the full experience on mobile — cab booking, live tracking, check-ins, SOS, and notifications. Pick the app you need below.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 16, padding: '24px', border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Truck size={22} color="#10b981" />
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>GetInRoute (Company)</h3>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: 0, lineHeight: 1.5 }}>For employees and drivers of corporate fleets. Cab booking, live GPS, check-ins, SOS, and trip chat.</p>
            <a href="/download/GetInRoute.apk" className="btn btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              <Download size={16} /> Android APK
            </a>
            <a href="/download/GetInRoute.ipa" className="btn" style={{ textDecoration: 'none', justifyContent: 'center', background: 'rgba(124,58,237,.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,.4)' }}>
              <Apple size={16} /> iPhone (TestFlight)
            </a>
          </div>
          <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 16, padding: '24px', border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <School size={22} color="#14b8a6" />
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>GetInRoute School</h3>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: 0, lineHeight: 1.5 }}>For school administrators, drivers, and transport staff. Student transport, routes, geofencing, and SOS for school fleets.</p>
            <a href="/download/GetInRoute-School.apk" className="btn btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              <Download size={16} /> Android APK (School)
            </a>
          </div>
        </div>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,.45)', fontSize: 12, marginTop: 18 }}>
          Android APKs download directly. The iPhone build is distributed through the Apple App Store / TestFlight — a link appears here once the build is approved.
        </p>
      </section>

      {/* SEO TEXT BLOCK — hidden from users, visible to search engines */}
      <section style={{ padding: '40px 20px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>About GetInRoute — Employee Transport Management Platform</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7 }}>
          GetInRoute is an enterprise employee transportation platform built for Indian companies. It replaces manual cab scheduling, phone-based driver coordination, and paper attendance registers with a single digital system. Admins manage routes, allocate cabs to employees, track drivers on a live map, and monitor speed — all from one dashboard. Employees use a mobile app to request cabs, check in and out, and confirm they reached home safely. Drivers follow GPS-optimized routes and report trip status in real time.
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, marginTop: 12 }}>
          GetInRoute supports unlimited transport vendors, each with their own fleet and driver pool. Admins can manage unlimited employees and vehicles from a single account. The platform includes cab allotment, multi-route dispatch, SOS emergency alerts, SafeDrop confirmation for women employees, night-hour doorstep drops, escort management, speed monitoring, and trip history — all features required by India's OSH Rules 2026 for workplace transportation.
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, marginTop: 12 }}>
          Unlike competitors like MoveInSync (Rs.3-10 per employee/month) and Routematic (Rs.3-150 per vehicle/month), GetInRoute charges a flat monthly fee starting at Rs.15,000/month with no per-employee or per-vehicle charges. It includes all safety features in the base plan — no module upsells. The platform is cloud-hosted on Railway (AWS), uses React Native for mobile apps (Android + iOS), Node.js/Express for the backend, and Leaflet/OpenStreetMap for all maps (no Google Maps dependency).
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, marginTop: 12 }}>
          Founded by C Edwin Peroli, GetInRoute is designed to make corporate employee transportation affordable, safe, and easy to manage for companies of all sizes.
        </p>
      </section>

      <footer className="footer">© {new Date().getFullYear()} GetinRoute — Fleet, employees & routes in one place.</footer>
    </div>
  );
}
