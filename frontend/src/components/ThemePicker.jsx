import React, { useEffect, useState } from 'react';

// Four professional palettes. Each portal (Admin / Vendor) stores its own
// preference under its own key so one never changes the other.
export const THEMES = [
  { id: 'navy', label: 'Navy Blue', swatch: '#0ea5e9' },
  { id: 'emerald', label: 'Emerald Teal', swatch: '#10b981' },
  { id: 'indigo', label: 'Indigo Purple', swatch: '#6366f1' },
  { id: 'graphite', label: 'Graphite', swatch: '#64748b' }
];

export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = 'dark';
}

export default function ThemePicker({ storageKey = 'getinroute-theme-admin' }) {
  const [theme, setTheme] = useState(() => {
    const t = localStorage.getItem(storageKey);
    return THEMES.some((x) => x.id === t) ? t : 'navy';
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
