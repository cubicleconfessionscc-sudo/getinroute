import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import {
  Command, Search, AlertTriangle, CheckCircle2, Activity, Zap, Users, TrendingUp,
  CalendarClock, Inbox, ShieldAlert, Cpu, Settings, X
} from 'lucide-react';

const SEVERITY_COLOR = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#10b981' };

export default function CommandCenter() {
  const toast = useToast();
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({});
  const [brief, setBrief] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [rules, setRules] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState([]);
  const [searchErr, setSearchErr] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v3/incidents').then((r) => setIncidents(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/v3/events', { limit: 40 }).then((r) => setEvents(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/v3/events/stats').then((r) => setStats(r || {})).catch(() => {});
    api.get('/api/v3/brief').then((r) => setBrief(r)).catch(() => {});
    api.get('/api/v3/automation/rules').then((r) => setRules(Array.isArray(r) ? r : [])).catch(() => {});
    Promise.all([
      api.get('/api/v3/predict/no-show').catch(() => null),
      api.get('/api/v3/predict/demand').catch(() => null),
      api.get('/api/v3/predict/utilization').catch(() => null)
    ]).then(([ns, demand, util]) => setPredictions({ ns, demand, util })).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useSocketEvent('realtime:events', (incoming) => {
    if (Array.isArray(incoming)) setEvents((prev) => [...incoming, ...prev].slice(0, 60));
  });

  const refresh = () => { load(); toast('Refreshed'); };

  const dismissEvent = async (e) => {
    try {
      await api.post(`/api/v3/events/${e.id}/dismiss`);
      setEvents((prev) => prev.filter((x) => x.id !== e.id));
      toast(`Event #${e.id} dismissed (audit kept)`);
    } catch (err) { toast(err.message || 'Failed to dismiss', 'err'); }
  };

  const transition = async (inc, toStatus) => {
    try {
      await api.post(`/api/v3/incidents/${inc.id}/transition`, { status: toStatus });
      setIncidents((prev) => prev.map((x) => x.id === inc.id ? { ...x, status: toStatus } : x));
      toast(`Incident → ${toStatus}`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const doSearch = async (e) => {
    e && e.preventDefault();
    if (!searchQ.trim()) { setSearchRes([]); setSearched(false); return; }
    setSearching(true);
    setSearchErr('');
    setSearched(false);
    try {
      const r = await api.get('/api/v3/search', { q: searchQ });
      const rows = r && Array.isArray(r.rows) ? r.rows : (Array.isArray(r) ? r : []);
      setSearchRes(rows);
      setSearched(true);
      if (r && r.error) { setSearchErr(r.error); toast(r.error, 'err'); }
      else if (!rows.length) { setSearchErr('No results found'); toast('No results found', 'info'); }
    } catch (err) {
      setSearchRes([]);
      setSearched(true);
      setSearchErr(err.message || 'Search failed');
      toast(err.message || 'Search failed', 'err');
    }
    finally { setSearching(false); }
  };

  const eventTotals = Object.values(stats).reduce((acc, s) => ({
    pending: acc.pending + (s.pending || 0),
    processed: acc.processed + (s.processed || 0),
    dead: acc.dead + (s.dead || 0)
  }), { pending: 0, processed: 0, dead: 0 });
  const openCount = incidents.filter((i) => !['resolved', 'reviewed'].includes(i.status)).length;
  const nextAction = { detected: 'acknowledged', acknowledged: 'classified', classified: 'assigned', assigned: 'mitigated', escalated: 'mitigated', mitigated: 'resolved', resolved: 'reviewed' };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Command size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Command Center</div>
          <div className="page-sub">Real-time operations: unified search, live events, incidents, automation, daily brief.</div>
        </div>
        <button className="btn btn-outline" onClick={refresh}>Refresh</button>
      </div>

      <form className="card" onSubmit={doSearch} style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Search size={18} style={{ color: 'var(--muted)' }} />
        <input
          style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)' }}
          placeholder="Search employees, drivers, vehicles, routes, trips, incidents, tickets…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <button className="btn btn-primary" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </form>

      {(searched || searchErr) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Results ({searchRes.length})</div>
          {searchRes.length === 0 ? (
            <div className="empty">
              {searching ? 'Searching…' : searchErr ? searchErr : `No results for “${searchQ}”. Try a different term.`}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {searchRes.slice(0, 12).map((r, idx) => (
                <div key={idx} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
                  <span style={{ textTransform: 'capitalize', fontWeight: 700, color: 'var(--primary)', fontSize: 11 }}>{r.category}</span>
                  <div style={{ marginTop: 4 }}>{r.name || r.vehicle_name || r.subject || r.plate || ('#' + (r.id ?? ''))}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{r.status || r.email || r.phone || ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, margin: '16px 0' }}>
        {[
          { label: 'Open Incidents', value: openCount, icon: <AlertTriangle size={20} />, color: openCount > 0 ? '#dc2626' : '#10b981' },
          { label: 'Events (24h)', value: eventTotals.processed, sub: `${eventTotals.pending} pending · ${eventTotals.dead} dead`, icon: <Activity size={20} />, color: '#2563eb' },
          { label: 'Active Rules', value: rules.filter((r) => r.enabled).length, sub: `${rules.length} total`, icon: <Zap size={20} />, color: '#7c3aed' },
          { label: 'Utilization', value: predictions?.util?.utilization != null ? predictions.util.utilization + '%' : '—', icon: <TrendingUp size={20} />, color: '#059669' },
          { label: 'No-Show Risk', value: predictions?.ns?.probability != null ? Math.round(predictions.ns.probability * 100) + '%' : '—', icon: <Users size={20} />, color: '#ca8a04' },
          { label: 'Forecast (7d)', value: predictions?.demand?.predictedDaily != null ? String(predictions.demand.predictedDaily) : '—', icon: <CalendarClock size={20} />, color: '#4f46e5' }
        ].map((kpi) => (
          <div key={kpi.label} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: kpi.color }}>{kpi.icon}<span style={{ fontSize: 24, fontWeight: 800 }}>{kpi.value}</span></div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{kpi.label}</div>
            {kpi.sub && <div className="muted" style={{ fontSize: 11 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '8fr 9fr', gap: 14 }}>
        <div className="card">
          <div className="card-title"><ShieldAlert size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Incidents</div>
          {incidents.length === 0 ? <div className="empty">No incidents</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>Severity</th><th style={{ padding: '8px' }}>Kind</th><th style={{ padding: '8px' }}>Score</th><th style={{ padding: '8px' }}>Status</th><th style={{ padding: '8px' }}>Action</th>
                </tr></thead>
                <tbody>
                  {incidents.filter((i) => !['resolved', 'reviewed'].includes(i.status)).map((i) => (
                    <tr key={i.id} style={{ borderBottom: '1px solid var(--line)', verticalAlign: 'top' }}>
                      <td style={{ padding: '8px' }}><span style={{ color: SEVERITY_COLOR[i.severity] || 'var(--muted)', fontWeight: 700, textTransform: 'capitalize' }}>{i.severity}</span></td>
                      <td style={{ padding: '8px' }}>{i.kind}</td>
                      <td style={{ padding: '8px' }}>{i.priority_score}</td>
                      <td style={{ padding: '8px', textTransform: 'capitalize' }}>{i.status}</td>
                      <td style={{ padding: '8px' }}>
                        {nextAction[i.status] && (
                          <button className="btn btn-xs" onClick={() => transition(i, nextAction[i.status])}>
                            {nextAction[i.status]}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title"><Activity size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Live Event Stream</div>
          {events.length === 0 ? <div className="empty">No events yet</div> : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {events.map((e) => (
                <div key={e.id} style={{ padding: '6px 2px', borderBottom: '1px solid var(--line)', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div><span style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.04)', padding: '1px 6px', borderRadius: 4 }}>{e.type}</span>
                    {e.payload && e.payload.sourceId && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>#{e.payload.sourceId}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{e.created}</span>
                    <button className="btn btn-xs btn-ghost" title="Dismiss (audit kept)" onClick={() => dismissEvent(e)}>
                      <X size={13} style={{ color: 'var(--muted)' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-title"><CalendarClock size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Daily Intelligence Brief</div>
          {!brief ? <div className="empty">Loading…</div> : (
            <>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                {brief.summary.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              {brief.riskRoutes && brief.riskRoutes.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12.5 }} className="muted">Routes with active trips: {brief.riskRoutes.map((r) => `${r.name} (${r.trips} trips)`).join(', ')}</div>
              )}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title"><Zap size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Automation Rules</div>
          {rules.length === 0 ? <div className="empty">No rules — create some in the Automation Builder</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Rule</th><th style={{ padding: '8px' }}>Event</th><th style={{ padding: '8px' }}>Level</th><th style={{ padding: '8px' }}>Runs</th><th style={{ padding: '8px' }}>State</th>
              </tr></thead>
              <tbody>
                {rules.slice(0, 8).map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: '8px' }}><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.event_type}</span></td>
                    <td style={{ padding: '8px' }}>{r.level}</td>
                    <td style={{ padding: '8px' }}>{r.run_count || 0}</td>
                    <td style={{ padding: '8px' }}>{r.enabled ? <span style={{ color: '#4ade80', fontWeight: 700 }}>ON</span> : <span className="muted">OFF</span>}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}