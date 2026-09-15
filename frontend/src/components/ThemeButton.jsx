import React, { useEffect, useState } from 'react';

const KEY = 'getinroute-theme';

function apply(theme) {
  const root = document.documentElement;
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
  return resolved;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(KEY) || 'dark');
  useEffect(() => {
    apply(theme);
    localStorage.setItem(KEY, theme);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => { if (theme === 'system') apply(theme); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  return [theme, setTheme];
}

export default function ThemeButton({ compact }) {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';
  const title = `Theme: ${theme} — click for ${next}`;
  if (compact) {
    return <button className="btn btn-ghost btn-icon" title={title} onClick={() => setTheme(next)}>{icon}</button>;
  }
  return (
    <button className="btn btn-outline btn-sm" title={title} onClick={() => setTheme(next)}>
      {icon} <span style={{ textTransform: 'capitalize' }}>{theme}</span>
    </button>
  );
}