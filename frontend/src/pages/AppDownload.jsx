import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Smartphone, Download, Share, PlusSquare, Check, QrCode,
  Info, ArrowLeft, Chrome
} from 'lucide-react';
import { APP_CONFIG, ANDROID_MIN, androidOf, iosOf } from '../config/apps';
import artifactManifest from '../config/appArtifacts.json';

const ICONS = {
  employee: Smartphone,
  driver: Smartphone,
  school: Smartphone,
  parent: Smartphone
};

const IN_APP_RE = /(WhatsApp|Instagram|FBAV|FBAN|Twitter|LinkedIn|Telegram|Snapchat|Line\/|Messenger|GSA)/i;
const NON_SAFARI_IOS_RE = /(CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo)/i;

function detect() {
  if (typeof navigator === 'undefined') return { kind: 'desktop', inApp: null, canInstallIos: false };
  const ua = navigator.userAgent || '';
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const inApp = ua.match(IN_APP_RE);

  if (isAndroid) {
    return { kind: 'android', inApp: inApp ? inApp[0] : null, canInstallIos: false };
  }
  if (isIos) {
    const nonSafari = NON_SAFARI_IOS_RE.test(ua);
    const embedded = !!inApp || nonSafari;
    return { kind: 'ios', inApp: inApp ? inApp[0] : null, canInstallIos: !embedded };
  }
  return { kind: 'desktop', inApp: null, canInstallIos: false };
}

const seenKey = (key) => `gir-install-guide-seen:${key}`;

function InstallSteps({ appKey, onClose }) {
  return (
    <div className="ios-overlay" role="dialog" aria-modal="true" aria-label="Install on iPhone">
      <div className="ios-overlay-card">
        <button className="ios-overlay-close" onClick={onClose} aria-label="Close">&times;</button>
        <h3>Add to your Home Screen</h3>
        <p className="ios-overlay-sub">Three taps, then it works like a normal app.</p>

        <ol className="ios-steps">
          <li>
            <Share size={18} />
            <span>Tap the <b>Share</b> icon in the Safari toolbar.</span>
          </li>
          <li>
            <PlusSquare size={18} />
            <span>Scroll down and tap <b>Add to Home Screen</b>.</span>
          </li>
          <li>
            <Check size={18} />
            <span>Tap <b>Add</b> in the top right.</span>
          </li>
        </ol>

        <div className="ios-share-hint">
          <span className="ios-share-dot" />
          <span>Look for the Share icon <span className="ios-share-icon"><Share size={15} /></span> at the bottom of the screen, between the <b>+</b> and <b>Tab</b> buttons.</span>
        </div>

        <button className="btn btn-primary ios-overlay-done" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

export default function AppDownload() {
  const { appKey } = useParams();
  const app = useMemo(() => APP_CONFIG.find((a) => a.key === appKey), [appKey]);

  const [device, setDevice] = useState(() => detect());
  const [showOverlay, setShowOverlay] = useState(false);
  const [qrBroken, setQrBroken] = useState(false);

  useEffect(() => {
    const onResize = () => setDevice(detect());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    if (!app) return;
    if (device.kind !== 'ios' || !device.canInstallIos || !app.pwaPath) return;
    try {
      if (!window.localStorage.getItem(seenKey(app.key))) setShowOverlay(true);
    } catch {
      setShowOverlay(true);
    }
  }, [device, app]);

  const dismiss = () => {
    if (app) {
      try { window.localStorage.setItem(seenKey(app.key), '1'); } catch { /* private mode */ }
    }
    setShowOverlay(false);
  };

  if (!app) {
    return (
      <div className="landing">
        <div className="pub-section" style={{ textAlign: 'center' }}>
          <h1>App not found</h1>
          <Link className="btn btn-primary" to="/apps">Back to apps</Link>
        </div>
      </div>
    );
  }

  const Icon = ICONS[app.key] || Smartphone;
  const android = androidOf(app);
  const ios = iosOf(app);
  const art = artifactManifest.apps[app.key] || null;
  const comingSoon = app.status === 'coming-soon';
  const hasAndroid = !!app.androidUrl;
  const qrSrc = `/apps/qr/${app.key}.svg`;
  const shareUrl = `${window.location.origin}${app.downloadPage || `/apps/${app.key}`}`;

  let cta = null;
  if (comingSoon) {
    cta = <span className="btn btn-soon dl-cta" aria-disabled="true">Coming soon</span>;
  } else if (device.kind === 'android' && hasAndroid) {
    cta = (
      <a className="btn btn-primary dl-cta" href={android.url} download={art?.file}>
        <Download size={20} /> Install for Android
      </a>
    );
  } else if (device.kind === 'ios' && app.pwaPath) {
    cta = device.canInstallIos ? (
      <button className="btn btn-primary dl-cta" onClick={() => setShowOverlay(true)}>
        <Share size={20} /> Install on iPhone
      </button>
    ) : (
      <span className="btn btn-soon dl-cta" aria-disabled="true">
        <Chrome size={20} /> Open in Safari to install
      </span>
    );
  } else if (device.kind === 'ios') {
    cta = <span className="btn btn-soon dl-cta" aria-disabled="true">iPhone build coming soon</span>;
  } else if (hasAndroid) {
    cta = (
      <a className="btn btn-primary dl-cta" href={android.url} download={art?.file}>
        <Download size={20} /> Download APK
      </a>
    );
  }

  return (
    <div className="landing">
      <header className="pub-nav" style={{ position: 'sticky', top: 0 }}>
        <Link to="/" className="pub-logo" aria-label="GetInRoute home">GetInRoute<span className="grad-text">.</span></Link>
        <nav className="pub-links" aria-label="Primary">
          <Link to="/#apps" className="pub-link">Apps</Link>
          <Link to="/apps" className="pub-link">All apps</Link>
        </nav>
        <div className="pub-nav-cta">
          <Link to="/login" className="btn btn-sm pub-login">Login</Link>
        </div>
      </header>

      <section className="pub-section dl-wrap">
        <Link to="/apps" className="dl-back"><ArrowLeft size={15} /> All apps</Link>

        <div className="pub-card dl-card">
          <div className="apps-card-head">
            <div className="pub-card-ico ico-indigo"><Icon size={26} /></div>
            <span className={`apps-state ${comingSoon ? 'coming-soon' : 'available'}`}>
              {comingSoon ? 'COMING SOON' : 'AVAILABLE'}
            </span>
          </div>

          <h1 className="dl-title">{app.name}</h1>
          <p className="apps-desc">{app.blurb}</p>

          {cta && <div className="dl-cta-row">{cta}</div>}

          {device.kind === 'ios' && app.pwaPath && !device.canInstallIos && (
            <div className="dl-callout dl-callout-warn">
              <Info size={16} />
              <span>
                {device.inApp
                  ? `You are viewing this inside ${device.inApp}. iPhone only allows installing from Safari.`
                  : 'This browser cannot install apps on iPhone. Use Safari instead.'}{' '}
                Tap the <b>Share</b> icon, then <b>Open in Safari</b>.
              </span>
            </div>
          )}

          {device.kind === 'ios' && !app.pwaPath && !comingSoon && (
            <div className="dl-callout">
              <Info size={16} />
              <span>The iPhone build is not published yet. Android is ready today.</span>
            </div>
          )}

          <div className="dl-meta">
            {art?.version && <span>v{art.version}</span>}
            {art?.sizeLabel && <span>{art.sizeLabel}</span>}
            <span>{ANDROID_MIN}</span>
            {art?.packageName && <code>{art.packageName}</code>}
          </div>

          {hasAndroid && !app.playUrl && (
            <p className="dl-note">
              Android will ask you to allow installs from this source (unknown sources).
              Turn it on for your browser, then reopen this page.
            </p>
          )}

          <div className="dl-qr">
            {qrBroken ? (
              <div className="dl-qr-fallback">
                <QrCode size={22} />
                <span>Scan this page on your phone:</span>
                <code>{shareUrl}</code>
              </div>
            ) : (
              <>
                <img
                  className="dl-qr-img"
                  src={qrSrc}
                  alt={`QR code to install ${app.name}`}
                  width="220"
                  height="220"
                  onError={() => setQrBroken(true)}
                />
                <p className="dl-qr-cap">
                  {device.kind === 'desktop'
                    ? 'Scan with your phone to open this page'
                    : 'Or scan this code from another device'}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {showOverlay && <InstallSteps appKey={app.key} onClose={dismiss} />}
    </div>
  );
}