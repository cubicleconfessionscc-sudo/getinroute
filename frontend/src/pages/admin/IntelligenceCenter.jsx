import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast, Badge } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { Brain, Activity, RefreshCw } from 'lucide-react';

const MODULE_META = {
  route_optimization: { label: 'Route Optimization', color: '#4f46e5' },
  vehicle_allocation: { label: 'Vehicle Allocation', color: '#7c3aed' },
  driver_allocation: { label: 'Driver Allocation', color: '#2563eb' },
  demand_analysis: { label: 'Demand Analysis', color: '#059669' },
  safety_scan: { label: 'Safety Scan', color: '#dc2626' },
  cost_intelligence: { label: 'Cost Intelligence', color: '#ca8a04' },
  anomaly_detection: { label: 'Anomaly Detection', color: '#e11d48' },
  root_cause: { label: 'Root Cause Analysis', color: '#6366f1' },
};
const RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['custom', 'Custom']];

function Kpis({ kpis }) {
  if (!kpis) return null;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0' }}>
      {Object.entries(kpis).map(([k, v]) => (
        <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px', minWidth: 90 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{v == null ? '—' : v}</div>
        </div>
      ))}
    </div>
  );
}
function Rows({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] == null ? '—' : String(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function HourBars({ byHour }) {
  if (!byHour) return null;
  const entries = Object.entries(byHour).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginTop: 8 }}>
      {entries.map(([h, v]) => (
        <div key={h} title={`${h}:00 — ${v}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ width: '100%', height: `${(v / max) * 60}px`, background: 'var(--primary)', borderRadius: 3 }} />
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{h}</span>
        </div>
      ))}
    </div>
  );
}

function ModuleCard({ m, onDecide, isAdmin }) {
  const meta = MODULE_META[m.key] || { label: m.key, color: '#64748b' };
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="card" style={{ borderLeft: `4px solid ${meta.color}`, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <b style={{ fontSize: 15 }}>{meta.label}</b>
        {m.status === 'ok' ? <Badge color="green">Live</Badge> : <Badge color="amber">Not enough data</Badge>}
        {isAdmin && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setShowRaw((s) => !s)}>{showRaw ? 'Hide raw data' : 'View raw data'}</button>}
      </div>
      {m.status !== 'ok' ? (
        <div style={{ color: 'var(--muted)', marginTop: 8 }}>{m.message}</div>
      ) : (
        <>
          <Kpis kpis={m.kpis} />
          {m.chart && m.chart.by_hour ? <HourBars byHour={m.chart.by_hour} /> : null}
          <Rows rows={m.rows} />
          {m.recommendation ? (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
              <div style={{ fontSize: 13 }}>{m.recommendation.text}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Confidence: {Math.round((m.recommendation.confidence || 0) * 100)}% · Support: {JSON.stringify(m.recommendation.supportingData || {})}</div>
              {m.recommendation.link ? <a href={m.recommendation.link} style={{ fontSize: 12 }}>Configure here →</a> : null}
              {m.recommendation.requiresApproval ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm btn-green" onClick={() => onDecide(m, 'APPROVED')}>Approve</button>
                  <button className="btn btn-sm btn-danger" onClick={() => onDecide(m, 'REJECTED')}>Reject</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {showRaw && <pre style={{ fontSize: 11, marginTop: 10, maxHeight: 240, overflow: 'auto', background: 'var(--bg)', padding: 10, borderRadius: 8 }}>{JSON.stringify(m, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}

export default function IntelligenceCenter() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = !user?.isOwner ? true : true; // raw toggle for admins/vendors
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const reloadTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const params = { range };
      if (range === 'custom') { params.from = from; params.to = to; }
      if (locationId) params.company_location_id = locationId;
      const r = await api.get('/api/v3/ai/center', params);
      setData(r);
      setLastUpdated(new Date());
    } catch (e) { toast(e.message, 'err'); }
    finally { setLoading(false); }
  }, [range, from, to, locationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/admin/locations').then((r) => setLocations(Array.isArray(r?.locations) ? r.locations : [])).catch(() => {});
  }, []);

  // Real-time: any live operational event refreshes the center (debounced).
  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(load, 800);
  }, [load]);
  ['driverLocation', 'alert', 'checkin:confirmed', 'allotment:statusBroadcast', 'sos:new', 'driver:duty'].forEach((evt) => useSocketEvent(evt, scheduleReload));

  const decide = async (m, decision) => {
    try {
      await api.post('/api/v3/ai/center/decide', { module: m.key, decision, text: m.recommendation?.text });
      toast(`Recommendation ${decision.toLowerCase()} (audit logged)`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const modules = Array.isArray(data?.modules) ? data.modules : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Brain size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Intelligence Center</div>
          <div className="page-sub">Computed live from your trips, vehicles, drivers, GPS, safety and billing data. Scoped to your company and location.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#16a34a', display: 'inline-block' }} /> Live
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : '—'}</span>
          <button className="btn btn-outline btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Date range</label>
          <select value={range} onChange={(e) => setRange(e.target.value)} className="input">
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {range === 'custom' && (
          <>
            <div><label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" /></div>
            <div><label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" /></div>
          </>
        )}
        {locations.length > 0 && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input">
              <option value="">All authorized locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        {data?.counts ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{data.counts.trips} trips · {data.counts.vehicles} vehicles · {data.counts.employees} employees</div> : null}
      </div>

      {loading ? <div className="card"><div className="empty"><Activity size={16} /> Computing live intelligence…</div></div> : null}
      {!loading && !modules.length ? <div className="card"><div className="empty">No intelligence data available.</div></div> : null}
      {modules.map((m) => <ModuleCard key={m.key} m={m} onDecide={decide} isAdmin={isAdmin} />)}
    </div>
  );
}
