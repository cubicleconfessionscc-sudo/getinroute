import React, { useEffect, useState } from 'react';

// Four professional palettes. Each portal (Admin / Vendor) stores its own
// preference under its own key so one never changes the other.
export const THEMES = [
  { id: 'royal-light', label: '👑 Royal Light', swatch: '#1e3a8a' },
  { id: 'royal-dark', label: '👑 Royal Dark', swatch: '#0b1220' },
  { id: 'royal-sapphire', label: '👑 Royal Sapphire', swatch: '#1d4ed8' },
  { id: 'royal-emerald', label: '👑 Royal Emerald', swatch: '#10b981' },
  { id: 'royal-indigo', label: '👑 Royal Indigo', swatch: '#4f46e5' },
  { id: 'royal-amethyst', label: '👑 Royal Amethyst', swatch: '#9333ea' },
  { id: 'royal-crimson', label: '👑 Royal Crimson', swatch: '#dc2626' },
  { id: 'royal-gold', label: '👑 Royal Gold', swatch: '#ca8a04' },
  { id: 'royal-ocean', label: '👑 Royal Ocean', swatch: '#0891b2' },
  { id: 'royal-teal', label: '👑 Royal Teal', swatch: '#0d9488' },
  { id: 'royal-plum', label: '👑 Royal Plum', swatch: '#a21caf' },
  { id: 'royal-bronze', label: '👑 Royal Bronze', swatch: '#b45309' },
  { id: 'royal-slate', label: '👑 Royal Slate', swatch: '#64748b' },
  { id: 'royal-midnight', label: '👑 Royal Midnight', swatch: '#1e40af' }
];

export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = 'dark';
}

export default function ThemePicker({ storageKey = 'getinroute-theme-admin' }) {
  const [theme, setTheme] = useState(() => {
    const t = localStorage.getItem(storageKey);
    return THEMES.some((x) => x.id === t) ? t : 'royal-dark';
  });
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  return (
    <div className="theme-picker">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`theme-opt ${theme === t.id ? 'on' : ''}`}
          onClick={() => setTheme(t.id)}
        >
          <span className="theme-sw" style={{ background: t.swatch }} />
          {t.label}
          {theme === t.id ? <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontWeight: 800 }}>✓</span> : null}
        </button>
      ))}
    </div>
  );
}
