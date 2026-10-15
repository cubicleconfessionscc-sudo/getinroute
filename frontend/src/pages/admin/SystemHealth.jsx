import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast, useInterval, Badge } from '../../components/ui';
import { Activity, Server, Database, RefreshCw, Play } from 'lucide-react';

function fmtDuration(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export default function SystemHealth() {
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;
  const [data, setData] = useState(null);
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/api/admin/server-events').then(setData).catch(() => {});
    api.get('/api/admin/backups').then(setBackups).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 20000);

  const runBackup = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/backups/run');
      toast('Backup created');
      load();
    } catch (e) { toast(e.message || 'Backup failed', 'err'); }
    setBusy(false);
  };

  const events = Array.isArray(data?.events) ? data.events : [];
  const files = Array.isArray(backups?.backups) ? backups.backups : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Activity size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />System Health</div>
          <div className="page-sub">Server uptime/downtime history and full on-server backups.</div>
        </div>
        <button className="btn btn-outline" onClick={load}><RefreshCw size={15} /> Refresh</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 20 }}>
        <div className="card">
          <div className="card-label"><Server size={14} /> Current uptime</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtDuration(data?.uptime_seconds)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Since {data?.started_at || '—'}</div>
        </div>
        <div className="card">
          <div className="card-label"><Activity size={14} /> Last heartbeat</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{data?.last_seen_at ? 'Live' : '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{data?.last_seen_at || '—'}</div>
        </div>
        <div className="card">
          <div className="card-label"><Database size={14} /> Backups kept</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{files.length}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{backups?.dir || '—'}</div>
        </div>
      </div>

      {isOwner && (
        <div style={{ marginBottom: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={runBackup}>
            <Play size={15} /> {busy ? 'Creating backup…' : 'Create full backup now'}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-label"><Activity size={14} /> Server start / stop history (downtime captured)</div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Event</th><th>When</th><th>Downtime before this start</th><th>Note</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.kind === 'start' ? <Badge color="green">START</Badge> : <Badge color="red">STOP</Badge>}</td>
                  <td>{e.at}</td>
                  <td>{e.kind === 'start' ? fmtDuration(e.downtime_seconds) : '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{e.note || '—'}</td>
                </tr>
              ))}
              {!events.length && <tr><td colSpan={4} className="empty">No server events recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-label"><Database size={14} /> Backup files</div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>File</th><th>Size</th><th>Created</th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{f.name}</td>
                  <td>{(f.size / 1048576).toFixed(2)} MB</td>
                  <td style={{ color: 'var(--muted)' }}>{new Date(f.at).toLocaleString()}</td>
                </tr>
              ))}
              {!files.length && <tr><td colSpan={3} className="empty">No backups yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
