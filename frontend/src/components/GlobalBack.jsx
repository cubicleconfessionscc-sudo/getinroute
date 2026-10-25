import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/* Global back affordance for the public/auth/portal pages that do not render
 * one of the app layouts (which have their own Back control in the header).
 * The marketing home page is excluded on purpose. */
const SKIP_PREFIXES = ['/app', '/driver', '/admin', '/school', '/parent', '/mobile-map'];

export default function GlobalBack() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  if (pathname === '/' || SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;
  return (
    <button
      type="button"
      onClick={() => { try { if (window.history.length > 1) nav(-1); else nav('/'); } catch { nav('/'); } }}
      aria-label="Back"
      title="Back"
      style={{
        position: 'fixed', top: 12, left: 12, zIndex: 400,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 999,
        border: '1px solid rgba(148,163,184,.35)',
        background: 'rgba(15,23,42,.72)', color: '#e2e8f0',
        fontSize: 13, fontWeight: 700, cursor: 'pointer',
        backdropFilter: 'blur(8px)'
      }}
    >
      <ArrowLeft size={15} /> Back
    </button>
  );
}
