import React from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, School, Navigation, Users, Download, Apple, Check, QrCode, ShieldCheck } from 'lucide-react';
import { APP_CONFIG, APP_STATUS_LABEL, androidOf, iosOf, RELEASE_VERSION, ANDROID_MIN } from '../config/apps';

const ICONS = {
  employee: Smartphone,
  driver: Navigation,
  parent: Users,
  school: School,
  admin: ShieldCheck
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
          {APP_CONFIG.map((app) => {
            const Icon = ICONS[app.key] || Smartphone;
            const android = androidOf(app);
            const ios = iosOf(app);
            return (
              <div className="pub-card apps-card" key={app.key}>
                <div className="apps-card-head">
                  <div className="pub-card-ico ico-indigo"><Icon size={26} /></div>
                  <span className={`apps-state ${app.status === 'coming-soon' ? 'coming-soon' : 'available'}`}>
                    {APP_STATUS_LABEL[app.status === 'coming-soon' ? 'coming-soon' : 'available']}
                  </span>
                </div>
                <h3>{app.name}</h3>
                <p className="apps-desc">{app.blurb}</p>
                <ul className="apps-feats">
                  {app.features.map((f, i) => (
                    <li key={i}><Check size={14} /> {f}</li>
                  ))}
                </ul>

                <div className="apps-platforms">
                  {/* Android: a real link whenever androidUrl is set. */}
                  <div className="apps-platform">
                    {android.available && app.status !== 'coming-soon' ? (
                      <a className="btn btn-primary btn-sm apps-platform-btn" href={android.url} download>
                        <Download size={15} /> {android.label}
                      </a>
                    ) : (
                      <span className="btn btn-sm btn-soon apps-platform-btn" aria-disabled="true">
                        <Download size={15} /> {app.status === 'coming-soon' ? 'Coming soon' : android.label}
                      </span>
                    )}
                    <span className="apps-platform-meta">
                      {app.status === 'coming-soon'
                        ? 'Not published yet'
                        : android.available ? `v${RELEASE_VERSION} · ${ANDROID_MIN}` : 'Not yet released'}
                    </span>
                    {android.id && <code className="apps-platform-id">{android.id}</code>}
                  </div>

                  {/* iPhone: enables itself only when iosUrl is a real URL. */}
                  <div className="apps-platform">
                    {ios.available ? (
                      <a className="btn btn-sm apps-platform-btn apps-ios-btn" href={ios.url} target="_blank" rel="noopener noreferrer">
                        <Apple size={15} /> {ios.label}
                      </a>
                    ) : (
                      <span className="btn btn-sm btn-soon apps-platform-btn" aria-disabled="true">
                        <Apple size={15} /> iPhone &mdash; Coming Soon
                      </span>
                    )}
                    <span className="apps-platform-meta">
                      {ios.available ? 'App Store / TestFlight' : 'Awaiting App Store release'}
                    </span>
                    {ios.id && <code className="apps-platform-id">{ios.id}</code>}
                  </div>
                </div>

                <Link
                  to={app.downloadPage || `/apps/${app.key}`}
                  className={app.status === 'coming-soon'
                    ? 'btn btn-ghost btn-sm apps-install-guide'
                    : 'btn btn-primary btn-sm apps-install-guide'}
                  style={{ justifyContent: 'center', width: '100%', marginTop: 10 }}
                >
                  <QrCode size={15} />
                  {app.status === 'coming-soon' ? 'Preview install page' : 'Install guide & QR code'}
                </Link>

                {app.webUrl && (
                  <Link to={app.webUrl} className="btn btn-ghost btn-sm" style={{ justifyContent: 'center', width: '100%', marginTop: 8 }}>{app.webLabel}</Link>
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