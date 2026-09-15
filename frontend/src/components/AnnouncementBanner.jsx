import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

const ICONS = { 1: 'ℹ️', 2: '📢', 3: '🚨' };

export default function AnnouncementBanner({ audiences = ['employee', 'both'] }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [shown, setShown] = useState(new Set());

  useEffect(() => {
    if (!user) return;
    api.get('/api/v3/apps/announcements', { audience: audiences.join(',') })
      .then((r) => {
        const arr = Array.isArray(r) ? r : [];
        const ours = arr.filter((a) => audiences.includes(a.audience) || a.audience === 'both');
        setItems(ours);
      }).catch(() => {});
  }, [user]);

  const ids = items.filter((a) => !shown.has(a.id));
  if (!ids.length) return null;
  const a = ids[0];
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', margin: '10px 12px', padding: 12,
      borderRadius: 12, border: '1px solid var(--line)', borderLeft: `5px solid ${a.importance >= 3 ? '#ef4444' : a.importance === 2 ? '#f59e0b' : '#10b981'}`,
      background: 'var(--card)', boxShadow: '0 2px 8px rgba(0,0,0,.04)'
    }}>
      <span style={{ fontSize: 18 }}>{ICONS[a.importance] || ICONS[1]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13.5 }}>{a.title}</b>
        <div style={{ fontSize: 12.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>
        {a.link_url && <a href={a.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)' }}>{a.link_url}</a>}
      </div>
      <button
        onClick={() => { if (shown.size >= 20) shown.clear(); setShown(new Set([...shown, a.id])); }}
        aria-label="Dismiss announcement"
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--muted)', padding: 2 }}
      >×</button>
    </div>
  );
}