import React from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, School, Navigation, Users, Download, Apple, Check } from 'lucide-react';
import { APP_LINKS, APP_STATUS_LABEL } from '../config/apps';

const ICONS = {
  employee: Smartphone,
  driver: Navigation,
  parent: Users,
  school: School
};

export default function Apps() {
  return (
    <div className="landing">
      <header className="pub-nav" style={{ position: 'sticky', top: 0 }}>
        <Link to="/" className="pub-logo" aria-label="GetInRoute home">GetInRoute<span className="grad-text">.</span></Link>
        <nav className="pub-links" aria-label="Primary">
          <Link to="/#about" className="pub-link">Platform</Link>
          <Link to="/#solutions" className="pub-link">Solutions</Link>
          <Link to="/#apps" className="pub-link">Apps</Link>
          <Link to="/#about" className="pub-link">About</Link>
          <Link to="/#founder" className="pub-link">Founder</Link>
          <Link to="/#contact" className="pub-link">Contact</Link>
        </nav>
        <div className="pub-nav-cta">
          <Link to="/login" className="btn btn-sm pub-login">Login</Link>
          <Link to="/register-company" className="btn btn-primary btn-sm pub-start">Get Started</Link>
        </div>
      </header>

      <section className="hero pub-hero-slim">
        <h1>
          ONE PLATFORM.<br />
          <span className="grad-text">EVERY JOURNEY.</span>
        </h1>
        <p className="pub-hero-desc">
          GetInRoute mobile apps keep employees, drivers, parents and schools connected wherever they go.
        </p>
      </section>

      <section className="pub-section" style={{ maxWidth: 1080 }}>
        <div className="apps-grid">
          {Object.values(APP_LINKS).map((app) => {
            const Icon = ICONS[app.key] || Smartphone;
            return (
              <div className="pub-card apps-card" key={app.key}>
                <div className="apps-card-head">
                  <div className="pub-card-ico ico-indigo"><Icon size={26} /></div>
                  <span className={`apps-state ${app.android.state}`}>{APP_STATUS_LABEL[app.android.state]}</span>
                </div>
                <h3>{app.name}</h3>
                <p className="apps-desc">{app.desc}</p>
                <ul className="apps-feats">
                  {app.features.map((f, i) => (
                    <li key={i}><Check size={14} /> {f}</li>
                  ))}
                </ul>
                <div className="apps-btns">
                  {app.android.url ? (
                    <a className="btn btn-primary btn-sm" href={app.android.url} download style={{ justifyContent: 'center', flex: 1 }}>
                      <Download size={15} /> {app.android.label}
                    </a>
                  ) : (
                    <span className="btn btn-sm btn-soon" style={{ flex: 1 }}><Download size={15} /> {app.android.label}</span>
                  )}
                  {app.ios.url ? (
                    <a className="btn btn-sm" href={app.ios.url} target="_blank" rel="noopener noreferrer" style={{ justifyContent: 'center', flex: 1, background: 'rgba(124,58,237,.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,.4)' }}>
                      <Apple size={15} /> {app.ios.label}
                    </a>
                  ) : (
                    <span className="btn btn-sm btn-soon" style={{ flex: 1 }}><Apple size={15} /> {app.ios.label}</span>
                  )}
                </div>
                {app.android.state === 'available' && (
                  <p className="apps-note" style={{ marginTop: 10 }}>
                    Installs as <code>{app.android.pkg}</code> &middot; v1.0.5 &middot; Android 7.0+ &middot; 16&nbsp;KB page-size safe
                  </p>
                )}
                {app.ios.url ? (
                  <p className="apps-note" style={{ marginTop: 10 }}>
                    App Store app &middot; <code>{app.ios.bundleId}</code>
                  </p>
                ) : app.ios.bundleId ? (
                  <p className="apps-note" style={{ marginTop: 10 }}>
                    iPhone build is ready as <code>{app.ios.bundleId}</code> &middot; awaiting App Store release
                  </p>
                ) : null}
                {app.web && app.web.state === 'available' && (
                  <Link to={app.web.url} className="btn btn-ghost btn-sm" style={{ justifyContent: 'center', width: '100%', marginTop: 10 }}>{app.web.label}</Link>
                )}
                {app.android.state !== 'available' && app.ios.state !== 'available' && (
                  <p className="apps-note">Native apps coming soon — the web app is live right now.</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="pub-muted-note" style={{ textAlign: 'center', marginTop: 18 }}>
          <strong>Upgrading from v1.0.4?</strong> v1.0.5 is signed with a new release key, so Android will not let it install over the old build.
          Uninstall the previous version once, then install v1.0.5 and sign in again.
        </p>
        <p className="pub-muted-note" style={{ textAlign: 'center', marginTop: 26 }}>
          Android APKs download directly from GetInRoute. iPhone builds are distributed through the Apple App Store / TestFlight — links appear here once a build is approved. We only publish real links, never placeholders.
        </p>
      </section>

      <footer className="pub-footer">
        <div className="pub-footer-bottom">© {new Date().getFullYear()} GetinRoute — Fleet, routes, people and safety in one place.</div>
      </footer>
    </div>
  );
}