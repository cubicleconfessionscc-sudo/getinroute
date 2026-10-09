import React, { useEffect, useRef, useState } from 'react';

// Every palette the app ships with. Each portal (Admin / Vendor) stores its own
// preference under its own key so one never changes the other. The picker shows
// the ACTUAL theme name (never just a colour dot) both for the current selection
// and for every option in the menu.
export const THEMES = [
  { id: 'royal-light', label: 'Royal Light', swatch: '#1e3a8a' },
  { id: 'royal-dark', label: 'Royal Dark', swatch: '#0b1220' },
  { id: 'royal-sapphire', label: 'Royal Sapphire', swatch: '#1d4ed8' },
  { id: 'royal-emerald', label: 'Royal Emerald', swatch: '#10b981' },
  { id: 'royal-indigo', label: 'Royal Indigo', swatch: '#4f46e5' },
  { id: 'royal-amethyst', label: 'Royal Amethyst', swatch: '#9333ea' },
  { id: 'royal-crimson', label: 'Royal Crimson', swatch: '#dc2626' },
  { id: 'royal-gold', label: 'Royal Gold', swatch: '#ca8a04' },
  { id: 'royal-ocean', label: 'Royal Ocean', swatch: '#0891b2' },
  { id: 'royal-teal', label: 'Royal Teal', swatch: '#0d9488' },
  { id: 'royal-plum', label: 'Royal Plum', swatch: '#a21caf' },
  { id: 'royal-bronze', label: 'Royal Bronze', swatch: '#b45309' },
  { id: 'royal-slate', label: 'Royal Slate', swatch: '#64748b' },
  { id: 'royal-midnight', label: 'Royal Midnight', swatch: '#1e40af' }
];

export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Royal palettes are dark-based except the explicit light one.
  root.style.colorScheme = theme === 'royal-light' ? 'light' : 'dark';
}

const themeById = (id) => THEMES.find((x) => x.id === id) || THEMES[1];

export default function ThemePicker({ storageKey = 'getinroute-theme-admin' }) {
  const [theme, setTheme] = useState(() => {
    const t = localStorage.getItem(storageKey);
    return THEMES.some((x) => x.id === t) ? t : 'royal-dark';
  });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = themeById(theme);

  return (
    <div className="theme-select" ref={wrapRef}>
      <button
        type="button"
        className="theme-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose a theme"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="theme-sw" style={{ background: current.swatch }} />
        <span className="theme-select-name">{current.label}</span>
        <span className="theme-select-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="theme-menu" role="listbox" aria-label="Theme">
          {THEMES.map((t) => (
            <li key={t.id} role="option" aria-selected={theme === t.id}>
              <button
                type="button"
                className={`theme-menu-item ${theme === t.id ? 'on' : ''}`}
                onClick={() => { setTheme(t.id); setOpen(false); }}
              >
                <span className="theme-sw" style={{ background: t.swatch }} />
                <span className="theme-menu-name">{t.label}</span>
                {theme === t.id ? <span className="theme-menu-check">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
