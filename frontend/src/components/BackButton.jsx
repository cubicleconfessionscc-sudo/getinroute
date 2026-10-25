import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/* One back control for every web page. Prefers real browser history; falls
   back to an explicit route (or the portal home) when the page was opened
   directly (e.g. from a bookmark or a new tab). */
export default function BackButton({ to, label = 'Back', className = 'btn btn-sm btn-ghost', style }) {
  const nav = useNavigate();
  const go = () => {
    try {
      if (window.history.length > 1) { nav(-1); return; }
    } catch { /* ignore */ }
    nav(to || '/');
  };
  return (
    <button type="button" className={className} style={style} onClick={go} aria-label={label} title={label}>
      <ArrowLeft size={15} /> <span>{label}</span>
    </button>
  );
}
