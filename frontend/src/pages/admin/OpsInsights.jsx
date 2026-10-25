import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, todayStr, downloadFile } from '../../api';
import { useInterval, useToast } from '../../components/ui';
import {
  Activity, Building2, CalendarRange, CheckCircle2, ClipboardCheck, Clock, Download,
  FileSpreadsheet, Gauge, LogIn, LogOut, MapPin, RefreshCw, Timer, Truck, Users, XCircle
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

/* Dashboard 2 — Operations Insights.
   A deliberately separate, read-only analytics surface from the existing
   Admin Dashboard. It answers "what happened, where and when": who signed in
   (and from which office), check-ins, trips completed/cancelled, driver duty
   time and per-location utilisation, with the full event timeline. */

const CHART = {
  blue: '#2563eb',
  sky: '#0ea5e9',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  slate: '#64748b',
  grid: 'rgba(148,163,184,.22)'
};

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtNum(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-IN');
}
function fmtTime(at) {
  const s = String(at || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[2]}` : s;
}
function fmtDay(at) {
  const s = String(at || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function initials(name) {
  return String(name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function Kpi({ icon, label, value, sub, tone = 'blue' }) {
  const tones = {
    blue: { bg: 'rgba(37,99,235,.12)', fg: '#2563eb' },
    green: { bg: 'rgba(16,185,129,.12)', fg: '#059669' },
    amber: { bg: 'rgba(245,158,11,.14)', fg: '#b45309' },
    red: { bg: 'rgba(239,68,68,.12)', fg: '#dc2626' },
    sky: { bg: 'rgba(14,165,233,.12)', fg: '#0284c7' },
    slate: { bg: 'rgba(100,116,139,.14)', fg: '#475569' }
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.15, marginTop: 2 }}>{value}</div>
        {sub ? <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function Section({ title, sub, right, children }) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15.5 }}>{title}</h3>
          {sub ? <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>{sub}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function OpsInsights() {
  const toast = useToast();
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(todayStr());
  const [locationId, setLocationId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const q = { from, to };
      if (locationId) q.location_id = locationId;
      const r = await api.get('/api/admin/insights', q);
      setData(r);
    } catch (e) {
      setError(e.message || 'Could not load insights');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [from, to, locationId]);

  useEffect(() => { load(); }, [load]);
  useInterval(() => load(true), 60000);

  const preset = (days) => { setTo(todayStr()); setFrom(isoDaysAgo(days - 1)); };

  const exportParams = useMemo(() => {
    const q = new URLSearchParams({ from, to });
    if (locationId) q.set('location_id', locationId);
    return q.toString();
  }, [from, to, locationId]);

  const download = async (kind, xlsx) => {
    try {
      const ext = xlsx ? 'xlsx' : 'csv';
      const url = `/api/admin/export/${kind}.${ext}?${exportParams}`;
      await downloadFile(url, `getinroute-${kind}-${from}-to-${to}.${ext}`);
      toast('Download started');
    } catch (e) { toast(e.message || 'Download failed', 'err'); }
  };

  const totals = data?.totals || {};
  const daily = data?.daily || [];
  const hourly = data?.hourly || [];
  const locations = data?.locations || [];
  const drivers = data?.drivers || [];
  const feed = data?.feed || [];
  const outcomes = [
    { name: 'Completed', value: totals.completed || 0, color: CHART.green },
    { name: 'Cancelled', value: totals.cancelled || 0, color: CHART.red },
    { name: 'In progress / other', value: Math.max(0, (totals.trips || 0) - (totals.completed || 0) - (totals.cancelled || 0)), color: CHART.slate }
  ].filter((x) => x.value > 0);

  return (
    <div className="page" style={{ display: 'grid', gap: 16 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Gauge size={24} color="var(--primary)" /> Dashboard 2 · Operations Insights
          </div>
          <div className="page-sub">Login activity with location, check-ins, trips, cancellations and driver duty — scoped to your access.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} /> Refresh
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => download('insights-events', false)}>
            <Download size={14} /> Events CSV
          </button>
          <button className="btn btn-green btn-sm" onClick={() => download('insights-events', true)}>
            <FileSpreadsheet size={14} /> Events Excel
          </button>
        </div>
      </div>

      <section className="card" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} className="btn btn-sm btn-outline" onClick={() => preset(d)}>{d}d</button>
          ))}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>To</label>
          <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">All locations in my scope</option>
            {locations.map((l) => (
              <option key={l.location_id} value={l.location_id}>{l.location}{l.city ? ` · ${l.city}` : ''}</option>
            ))}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" onClick={() => download('insights-daily', false)}><Download size={13} /> Daily CSV</button>
          <button className="btn btn-sm btn-green" onClick={() => download('insights-daily', true)}><FileSpreadsheet size={13} /> Daily Excel</button>
          <button className="btn btn-sm btn-outline" onClick={() => download('insights-locations', false)}><Download size={13} /> Locations CSV</button>
          <button className="btn btn-sm btn-green" onClick={() => download('insights-locations', true)}><FileSpreadsheet size={13} /> Locations Excel</button>
        </div>
      </section>

      {error ? (
        <div className="card" role="alert" style={{ padding: 14, borderColor: 'rgba(239,68,68,.4)', color: '#dc2626', fontWeight: 600 }}>
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading insights…</div>
      ) : null}

      {data ? (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <Kpi icon={<Users size={18} />} label="Employees in scope" value={fmtNum(totals.employees)} sub={`${fmtNum(totals.active_locations)} active locations`} tone="blue" />
            <Kpi icon={<LogIn size={18} />} label="Logins" value={fmtNum(totals.logins)} sub={`${fmtNum(totals.active_employees)} employees signed in`} tone="green" />
            <Kpi icon={<LogOut size={18} />} label="Logouts" value={fmtNum(totals.logouts)} sub={`${fmtNum(totals.logins - totals.logouts)} not signed out yet`} tone="slate" />
            <Kpi icon={<ClipboardCheck size={18} />} label="Check-ins" value={fmtNum(totals.checkins)} sub={`${fmtNum(totals.checkouts)} office check-outs`} tone="sky" />
            <Kpi icon={<Activity size={18} />} label="Trips" value={fmtNum(totals.trips)} sub={`${fmtNum(totals.completed)} completed`} tone="blue" />
            <Kpi icon={<XCircle size={18} />} label="Cancelled" value={fmtNum(totals.cancelled)} sub={totals.trips ? `${Math.round((totals.cancelled / totals.trips) * 100)}% of trips` : 'No trips in range'} tone="red" />
            <Kpi icon={<Timer size={18} />} label="Avg pickup delay" value={totals.avg_pickup_delay_min == null ? '—' : `${totals.avg_pickup_delay_min > 0 ? '+' : ''}${totals.avg_pickup_delay_min} min`} sub="Scheduled vs actual check-in" tone={totals.avg_pickup_delay_min > 5 ? 'amber' : 'green'} />
            <Kpi icon={<Clock size={18} />} label="Driver duty hours" value={`${fmtNum(totals.duty_hours)} h`} sub={`${fmtNum(totals.drivers_on_duty)} drivers on duty now`} tone="amber" />
            <Kpi icon={<Truck size={18} />} label="Active vehicles" value={fmtNum(totals.vehicles_active)} sub={`${fmtNum(totals.drivers)} drivers in scope`} tone="slate" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <Section title="Daily activity" sub="Logins, check-ins and trips per day">
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} stroke={CHART.slate} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={CHART.slate} />
                    <Tooltip labelFormatter={(v) => fmtDay(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="logins" name="Logins" stroke={CHART.blue} strokeWidth={2.4} dot={false} />
                    <Line type="monotone" dataKey="checkins" name="Check-ins" stroke={CHART.sky} strokeWidth={2.2} dot={false} />
                    <Line type="monotone" dataKey="trips" name="Trips" stroke={CHART.green} strokeWidth={2.2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Peak login hours" sub="When employees start their day">
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={hourly} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, '0')}:00`} interval={2} tick={{ fontSize: 10.5 }} stroke={CHART.slate} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={CHART.slate} />
                    <Tooltip labelFormatter={(h) => `${String(h).padStart(2, '0')}:00`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="logins" name="Logins" fill={CHART.blue} radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Trips by location" sub="Utilisation across your operational locations">
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={locations} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="location" tick={{ fontSize: 10 }} stroke={CHART.slate} interval={0} angle={-18} textAnchor="end" height={54} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={CHART.slate} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="trips" name="Trips" fill={CHART.blue} radius={[5, 5, 0, 0]} />
                    <Bar dataKey="logins" name="Logins" fill={CHART.sky} radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Trip outcomes" sub="Completed vs cancelled in the selected range">
              <div style={{ width: '100%', height: 260 }}>
                {outcomes.length ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={60} outerRadius={92} paddingAngle={3}>
                        {outcomes.map((o) => <Cell key={o.name} fill={o.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>No trips in this range yet.</div>
                )}
              </div>
            </Section>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
            <Section title="Location performance" sub="Employees, logins, check-ins and trips per location">
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Location</th>
                      <th>Employees</th>
                      <th>Logins</th>
                      <th>Check-ins</th>
                      <th>Trips</th>
                      <th>Done</th>
                      <th>Cancelled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((l) => (
                      <tr key={l.location_id}>
                        <td style={{ textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <MapPin size={13} color="var(--primary)" />
                            <span style={{ fontWeight: 600 }}>{l.location}</span>
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>{[l.city, l.state].filter(Boolean).join(', ')}</span>
                          </div>
                        </td>
                        <td>{fmtNum(l.employees)}</td>
                        <td>{fmtNum(l.logins)}</td>
                        <td>{fmtNum(l.checkins)}</td>
                        <td>{fmtNum(l.trips)}</td>
                        <td style={{ color: '#059669', fontWeight: 600 }}>{fmtNum(l.completed)}</td>
                        <td style={{ color: l.cancelled ? '#dc2626' : undefined, fontWeight: l.cancelled ? 600 : 400 }}>{fmtNum(l.cancelled)}</td>
                      </tr>
                    ))}
                    {!locations.length ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>No locations in scope.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Driver activity" sub="Trips, duty hours and last sign-in">
              <div style={{ overflowX: 'auto', maxHeight: 340 }}>
                <table className="table" style={{ width: '100%', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Driver</th>
                      <th style={{ textAlign: 'left' }}>Vehicle</th>
                      <th>Trips</th>
                      <th>Completed</th>
                      <th>Duty</th>
                      <th style={{ textAlign: 'left' }}>Last login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr key={d.driver_id}>
                        <td style={{ textAlign: 'left' }}>
                          <span style={{ fontWeight: 600 }}>{d.name}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {d.emp_id || '—'}</span>
                        </td>
                        <td style={{ textAlign: 'left' }}>{d.vehicle || '—'}{d.plate ? ` · ${d.plate}` : ''}</td>
                        <td>{fmtNum(d.trips)}</td>
                        <td style={{ color: '#059669', fontWeight: 600 }}>{fmtNum(d.completed)}</td>
                        <td>{d.duty_hours ? `${d.duty_hours} h` : '—'}</td>
                        <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{d.last_login || 'Never'}</td>
                      </tr>
                    ))}
                    {!drivers.length ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>No drivers in scope.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>

          <Section
            title="Live activity feed"
            sub="Logins/logouts, driver arrivals, boarding, office check-ins and completed trips — newest first"
            right={<span className="chip" style={{ fontSize: 11 }}><CheckCircle2 size={12} /> {feed.length} recent events</span>}
          >
            <div style={{ display: 'grid', gap: 6, maxHeight: 440, overflowY: 'auto' }}>
              {feed.map((e, i) => {
                const tone = e.kind === 'login' ? CHART.green : e.kind === 'logout' ? CHART.slate
                  : e.kind === 'driver_arrived' ? CHART.amber : e.kind === 'cancelled' ? CHART.red
                    : e.kind === 'office_arrival' || e.kind === 'checkout' ? CHART.sky : CHART.blue;
                return (
                  <div key={`${e.at}-${e.kind}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface-2)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${tone}1f`, color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11, flexShrink: 0 }}>
                      {initials(e.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{e.label}{e.name ? ` — ${e.name}` : ''}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[e.location, e.vehicle, e.lat != null && e.lng != null ? `${Number(e.lat).toFixed(4)}, ${Number(e.lng).toFixed(4)}` : null].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtTime(e.at)}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmtDay(e.at)}</div>
                    </div>
                  </div>
                );
              })}
              {!feed.length ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  No activity recorded yet. Logins, check-ins and trip events will appear here as they happen.
                </div>
              ) : null}
            </div>
          </Section>

          <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <CalendarRange size={16} color="var(--primary)" />
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Showing {data.range.days} day{data.range.days === 1 ? '' : 's'} ({data.range.from} → {data.range.to}) · generated {data.generated_at}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-outline" onClick={() => download('insights-daily', false)}><Download size={13} /> Daily CSV</button>
              <button className="btn btn-sm btn-green" onClick={() => download('insights-daily', true)}><FileSpreadsheet size={13} /> Daily Excel</button>
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
