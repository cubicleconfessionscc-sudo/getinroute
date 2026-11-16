import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../auth';
import { Lock } from 'lucide-react';

/**
 * Owner-gated feature wrapper.
 *
 * The platform owner always has access (they are the one who turns features
 * on). Company / admin / vendor portals may only see and use a feature once
 * the owner has enabled its flag in Feature Flags — platform default or a
 * per-company override.
 *
 * Fail-open semantics, identical to the sidebar's `flagOn`: while flags are
 * still loading (or the request failed) the page renders, and a flag key that
 * isn't in the response also renders. Only an explicit `enabled: false`
 * blocks, so a transient problem can never lock admins out of their portal.
 */
export default function FlagGate({ flag, label, children }) {
  const { user } = useAuth();
  const ctx = useOutletContext() || {};
  const flags = ctx.flags;
  const owner = !!(user && user.isOwner);
  const blocked = !owner && !!flags && flags[flag] === false;
  if (!blocked) return children;
  return (
    <div className="page" data-testid="feature-disabled" data-flag={flag}>
      <div className="card" style={{ maxWidth: 560, margin: '56px auto', textAlign: 'center', padding: '40px 28px' }}>
        <Lock size={34} style={{ color: 'var(--muted)', marginBottom: 12 }} />
        <div className="page-title" style={{ justifyContent: 'center' }}>Feature switched off</div>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
          <b>{label || String(flag || '').replace(/_/g, ' ').toLowerCase()}</b> is not enabled for your company yet.
          Ask the platform owner to turn it on from Feature Flags, then reload this page.
        </p>
        <button className="btn btn-primary" data-testid="feature-disabled-back" onClick={() => { window.location.href = '/admin'; }}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
