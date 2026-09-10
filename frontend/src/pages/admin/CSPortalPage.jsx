import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Badge, useToast } from '../../components/ui';
import { Search, AlertTriangle, Activity, BarChart3, ClipboardCheck, Shield, Wrench, Trash2 } from 'lucide-react';

const STATUS_COLORS = { open: 'amber', in_progress: 'indigo', escalated: 'red', resolved: 'green', closed: 'slate' };
const PRIORITY_COLORS = { low: 'slate', medium: 'amber', high: 'red', urgent: 'red' };
const ESC_COLORS = { employee: 'slate', admin: 'violet', owner: 'red' };

const TAB_LABELS = { dashboard: 'Dashboard', tickets: 'Tickets', diagnose: 'Paste & Diagnose' };
const FINDING_TONES = { employee: 'violet', phone: 'blue', date: 'indigo', speed: 'red', ticket: 'amber', vehicle: 'green' };

const fmt = (v) => String(v == null || v === '' ? '—' : v).replace(/_/g, ' ');

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

const countOf = (v) => (Array.isArray(v) ? v.length : v == null || v === '' ? '—' : v);

const nameOf = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.name || v.plate || v.full_name || '—';
  return String(v);
};

function StatCard({ icon: Icon, tone, value, label }) {
  return (
    <div className="stat">
      <div className={`ico ${tone}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="num">{value}</div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}

function TicketLine({ t, right, onDelete }) {
  return (
    <Link
      to={`/admin/tickets/${t.id}`}
      className="card"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', marginBottom: 8, textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          #{t.id} · {t.subject || 'Untitled'}
        </div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>{fmtDate(t.created_at)}</div>
      </div>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        {right}
        {onDelete && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            title="Delete ticket"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <Trash2 size={14} color="#ef4444" />
          </button>
        )}
      </span>
    </Link>
  );
}

function KV({ k, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.7 }}>
      <span style={{ minWidth: 140, opacity: 0.6, flexShrink: 0 }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

function Summary({ summary, findings }) {
  const count = Array.isArray(findings) ? findings.length : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
      <BarChart3 size={16} />
      {typeof summary === 'string' && summary ? (
        <span>{summary}</span>
      ) : summary && typeof summary === 'object' ? (
        <span>
          {Object.entries(summary)
            .map(([k, v]) => `${fmt(k)}: ${Array.isArray(v) ? v.length : v}`)
            .join(' · ')}
        </span>
      ) : null}
      <Badge color="indigo">
        {count} finding{count === 1 ? '' : 's'}
      </Badge>
    </div>
  );
}

function FindingCard({ index, finding }) {
  const d = finding?.data || finding || {};
  const type = finding?.type || 'unknown';

  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, textTransform: 'capitalize' }}>
          {type === 'speed' ? (
            <Activity size={16} />
          ) : type === 'ticket' ? (
            <Wrench size={16} />
          ) : type === 'vehicle' ? (
            <Shield size={16} />
          ) : type === 'employee' ? (
            <ClipboardCheck size={16} />
          ) : (
            <Search size={16} />
          )}
          {fmt(type)} match #{index + 1}
        </div>
        <Badge color={FINDING_TONES[type] || 'slate'}>{fmt(type)}</Badge>
      </div>

      {type === 'employee' && (
        <>
          <KV k="Employee ID">{d.emp_id || '—'}</KV>
          <KV k="Name">{d.name || '—'}</KV>
          <KV k="Email">{d.email || '—'}</KV>
          <KV k="Approved">{d.approved == null ? '—' : d.approved ? 'Yes' : 'No'}</KV>
          <KV k="Status">
            <Badge color={d.approved ? 'green' : 'slate'}>{fmt(d.status)}</Badge>
          </KV>
          <KV k="Recent schedules">
            {Array.isArray(d.recent_schedules) && d.recent_schedules.length ? (
              d.recent_schedules.map((s, i) => (
                <div key={i}>{typeof s === 'string' ? s : [s.date, s.shift, s.route].filter(Boolean).join(' · ')}</div>
              ))
            ) : (
              '—'
            )}
          </KV>
          <KV k="Last vehicle">{nameOf(d.last_vehicle)}</KV>
        </>
      )}

      {type === 'phone' && (
        <>
          <KV k="Phone">{d.phone || '—'}</KV>
          <KV k="Name">{d.name || '—'}</KV>
          <KV k="Employee ID">{d.emp_id || '—'}</KV>
          <KV k="Role">{fmt(d.role)}</KV>
        </>
      )}

      {type === 'date' && (
        <>
          <KV k="Date">{d.date || '—'}</KV>
          <KV k="Schedules">{countOf(d.schedules)}</KV>
          <KV k="Check-ins">{countOf(d.checkins)}</KV>
          <KV k="Active trips">{countOf(d.active_trips)}</KV>
        </>
      )}

      {type === 'speed' && (
        <>
          <KV k="Speeds found">
            {countOf(d.speeds_found)}
            {Array.isArray(d.speeds_found) && d.speeds_found.length ? ` (${d.speeds_found.join(', ')})` : ''}
          </KV>
          <KV k="Max speed">{d.max_speed != null ? `${d.max_speed} km/h` : '—'}</KV>
          <KV k="Matching events">{countOf(d.matching_events)}</KV>
          <KV k="Recent events">
            {Array.isArray(d.recent_events) && d.recent_events.length ? (
              d.recent_events.slice(0, 5).map((e, i) => (
                <div key={i}>
                  {nameOf(e.vehicle_name)} — <strong>{e.speed}</strong> km/h (limit {e.speed_limit})
                </div>
              ))
            ) : (
              '—'
            )}
          </KV>
        </>
      )}

      {type === 'ticket' && (
        <>
          <KV k="Ticket">
            <Link to={`/admin/tickets/${d.id}`}>#{d.id}</Link>
          </KV>
          <KV k="Subject">{d.subject || '—'}</KV>
          <KV k="Status">
            <Badge color={STATUS_COLORS[d.status] || 'slate'}>{fmt(d.status)}</Badge>
          </KV>
          <KV k="Priority">
            <Badge color={PRIORITY_COLORS[d.priority] || 'slate'}>{fmt(d.priority)}</Badge>
          </KV>
          <KV k="Escalation">
            <Badge color={ESC_COLORS[d.escalation] || 'slate'}>{fmt(d.escalation)}</Badge>
          </KV>
          <KV k="Creator">{d.creator_name || d.creator || '—'}</KV>
        </>
      )}

      {type === 'vehicle' && (
        <>
          <KV k="Plate">{d.plate || '—'}</KV>
          <KV k="Name">{d.name || '—'}</KV>
          <KV k="Status">
            <Badge color="slate">{fmt(d.status)}</Badge>
          </KV>
          <KV k="Live status">{fmt(d.live_status)}</KV>
          <KV k="Driver">{nameOf(d.driver)}</KV>
        </>
      )}

      {!['employee', 'phone', 'date', 'speed', 'ticket', 'vehicle'].includes(type) &&
        Object.entries(d).map(([k, v]) => (
          <KV key={k} k={fmt(k)}>
            {v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
          </KV>
        ))}
    </div>
  );
}

export default function CSPortalPage() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({});
  const [tab, setTab] = useState('dashboard');
  const [filter, setFilter] = useState({ status: '', escalation_level: '' });
  const [diagnoseInput, setDiagnoseInput] = useState('');
  const [diagnoseResults, setDiagnoseResults] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [search, setSearch] = useState('');
  const toast = useToast();
  const { user } = useAuth();

  const delTicket = async (e, id) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!confirm(`Delete ticket #${id} permanently? This cannot be undone.`)) return;
    try {
      await api.del(`/api/tickets/${id}`);
      toast('Ticket deleted');
      setTickets((prev) => prev.filter((x) => x.id !== id));
    } catch (err) { toast(err.message, 'err'); }
  };

  useEffect(() => {
    let alive = true;
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== '' && v != null));
    Promise.all([api.get('/api/cs/stats'), api.get('/api/cs/tickets', params)])
      .then(([statsRes, ticketsRes]) => {
        if (!alive) return;
        const s = statsRes?.data ?? statsRes;
        const t = ticketsRes?.data ?? ticketsRes;
        setStats(s && typeof s === 'object' ? s : {});
        setTickets(Array.isArray(t) ? t : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [filter]);

  const notify = (message, type) => {
    if (typeof toast === 'function') toast(message, type);
    else if (type === 'error' && toast?.error) toast.error(message);
    else if (type === 'success' && toast?.success) toast.success(message);
  };

  const runDiagnose = async () => {
    if (!diagnoseInput.trim() || diagnosing) return;
    setDiagnosing(true);
    try {
      const res = await api.post('/api/tickets/diagnose', { text: diagnoseInput });
      setDiagnoseResults(res?.data ?? res ?? null);
    } catch {
      notify('Diagnosis failed. Please try again.', 'error');
    } finally {
      setDiagnosing(false);
    }
  };

  const statVal = (...keys) => {
    for (const k of keys) if (stats[k] != null) return stats[k];
    return 0;
  };

  const escalated = tickets
    .filter((t) => t.status === 'escalated' || t.escalation_level === 'owner')
    .slice(0, 5);

  const q = search.trim().toLowerCase();
  const filteredTickets = tickets.filter((t) => {
    if (!q) return true;
    return (
      String(t.id).toLowerCase().includes(q) ||
      (t.subject || '').toLowerCase().includes(q) ||
      (t.creator_name || t.creator || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">CS &amp; Owner Portal</h1>
          <p className="page-sub">Support desk, escalations and diagnostics at a glance</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.keys(TAB_LABELS).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,.35)',
                background: tab === key ? 'rgba(99,102,241,.15)' : 'transparent',
                fontWeight: tab === key ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="stats">
            <StatCard icon={ClipboardCheck} tone="ico-amber" value={statVal('open', 'open_tickets')} label="Open" />
            <StatCard icon={AlertTriangle} tone="ico-red" value={statVal('escalated', 'escalated_tickets')} label="Escalated" />
            <StatCard icon={Shield} tone="ico-violet" value={statVal('owner_queue', 'owner')} label="Owner Queue" />
            <StatCard icon={Activity} tone="ico-red" value={statVal('urgent')} label="Urgent" />
            <StatCard icon={BarChart3} tone="ico-blue" value={statVal('today', 'created_today')} label="Today" />
            <StatCard icon={Wrench} tone="ico-green" value={statVal('resolved', 'resolved_tickets')} label="Resolved" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <AlertTriangle size={16} />
                <strong>Escalated Tickets</strong>
              </div>
              {escalated.length === 0 ? (
                <p style={{ opacity: 0.6 }}>No escalated tickets right now.</p>
              ) : (
                escalated.map((t) => (
                  <TicketLine
                    key={t.id}
                    t={t}
                    onDelete={() => delTicket(null, t.id)}
                    right={
                      <>
                        <Badge color={ESC_COLORS[t.escalation_level] || 'slate'}>{fmt(t.escalation_level)}</Badge>
                        <Badge color={PRIORITY_COLORS[t.priority] || 'slate'}>{fmt(t.priority)}</Badge>
                      </>
                    }
                  />
                ))
              )}
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Activity size={16} />
                <strong>Recent Activity</strong>
              </div>
              {tickets.length === 0 ? (
                <p style={{ opacity: 0.6 }}>No ticket activity yet.</p>
              ) : (
                tickets.slice(0, 5).map((t) => (
                  <TicketLine
                    key={t.id}
                    t={t}
                    onDelete={() => delTicket(null, t.id)}
                    right={<Badge color={STATUS_COLORS[t.status] || 'slate'}>{fmt(t.status)}</Badge>}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'tickets' && (
        <>
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '8px 10px' }}>
              <Search size={16} style={{ opacity: 0.6 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search id, subject, creator..."
                style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', color: 'inherit' }}
              />
            </div>
            <select
              value={filter.status}
              onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)' }}
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_COLORS).map((s) => (
                <option key={s} value={s}>
                  {fmt(s)}
                </option>
              ))}
            </select>
            <select
              value={filter.escalation_level}
              onChange={(e) => setFilter((f) => ({ ...f, escalation_level: e.target.value }))}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)' }}
            >
              <option value="">All levels</option>
              {Object.keys(ESC_COLORS).map((l) => (
                <option key={l} value={l}>
                  {fmt(l)}
                </option>
              ))}
            </select>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Subject</th>
                    <th>Creator</th>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Level</th>
                    <th>Status</th>
                    <th>Comments</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>
                        No tickets found.
                      </td>
                    </tr>
                  ) : (
                    filteredTickets.map((t) => (
                      <tr key={t.id} onClick={() => { window.location.href = `/admin/tickets/${t.id}`; }} style={{ cursor: 'pointer' }}>
                        <td>#{t.id}</td>
                        <td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Link to={`/admin/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>
                            {t.subject || 'Untitled'}
                          </Link>
                        </td>
                        <td>{t.creator_name || t.creator || '—'}</td>
                        <td>{fmt(t.category)}</td>
                        <td>
                          <Badge color={PRIORITY_COLORS[t.priority] || 'slate'}>{fmt(t.priority)}</Badge>
                        </td>
                        <td>
                          <Badge color={ESC_COLORS[t.escalation_level] || 'slate'}>{fmt(t.escalation_level)}</Badge>
                        </td>
                        <td>
                          <Badge color={STATUS_COLORS[t.status] || 'slate'}>{fmt(t.status)}</Badge>
                        </td>
                        <td>{Array.isArray(t.comments) ? t.comments.length : t.comments_count ?? 0}</td>
                        <td>{fmtDate(t.created_at)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={(e) => delTicket(e, t.id)}
                            title="Delete ticket"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
                          >
                            <Trash2 size={15} color="#ef4444" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'diagnose' && (
        <>
          <div className="card" style={{ padding: 20 }}>
            <h2 style={{ margin: '0 0 6px' }}>Paste &amp; Diagnose Tool</h2>
            <p style={{ margin: '0 0 14px', opacity: 0.7 }}>
              Paste any text — employee IDs, phone numbers, dates, vehicle numbers, ticket IDs — and the system will extract and cross-reference data.
            </p>
            <textarea
              rows={8}
              value={diagnoseInput}
              onChange={(e) => setDiagnoseInput(e.target.value)}
              placeholder="Paste employee IDs, phone numbers, dates, vehicle numbers, ticket IDs..."
              style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', fontFamily: 'inherit', resize: 'vertical', background: 'transparent', color: 'inherit' }}
            />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-primary" onClick={runDiagnose} disabled={diagnosing || !diagnoseInput.trim()}>
                {diagnosing ? 'Analyzing...' : 'Analyze'}
              </button>
              {diagnoseResults && !diagnosing && (
                <button
                  onClick={() => {
                    setDiagnoseResults(null);
                    setDiagnoseInput('');
                  }}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', background: 'transparent', cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {diagnoseResults && (
            <div className="card" style={{ padding: 20, marginTop: 16 }}>
              <h2 style={{ margin: '0 0 10px' }}>Results</h2>
              <Summary summary={diagnoseResults.summary} findings={diagnoseResults.findings} />
              {Array.isArray(diagnoseResults.findings) && diagnoseResults.findings.length > 0 ? (
                diagnoseResults.findings.map((f, i) => <FindingCard key={`${f?.type || 'unknown'}-${i}`} index={i} finding={f} />)
              ) : (
                <p style={{ opacity: 0.6 }}>No matches found in the provided text.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
