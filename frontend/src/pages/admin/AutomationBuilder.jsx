import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { Zap, Plus, Trash2, Power, History, ShieldCheck, ChevronDown, Play } from 'lucide-react';

const EVENT_TYPES = ['*', 'trip.started', 'trip.completed', 'trip.delayed', 'sos.event', 'sos.realtime',
  'overspeed.event', 'geofence.event', 'safety.event', 'heartbeat.event', 'checkin.checkin', 'checkin.checkout',
  'billing.anomaly.detected', 'incident.detected', 'capacity.shortage'];
const ACTION_KINDS = ['create_incident', 'recommend', 'escalate', 'notify'];
const EMPTY_COND = () => ({ field: '', op: 'eq', value: '' });
const EMPTY_ACT = () => ({ kind: 'create_incident', params: {} });

export default function AutomationBuilder() {
  const toast = useToast();
  const [rules, setRules] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ id: null, name: '', event_type: '*', level: 1, max_confidence: '', conditions: [], actions: [] });

  const load = () => {
    api.get('/api/v3/automation/rules').then((r) => setRules(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/v3/automation/executions').then((r) => setExecutions(Array.isArray(r) ? r : [])).catch(() => {});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const setCond = (i, patch) => setForm((f) => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const setAct = (i, patch) => setForm((f) => ({ ...f, actions: f.actions.map((a, idx) => idx === i ? { ...a, ...patch } : a) }));

  const sanitize = () => ({
    id: form.id,
    name: form.name.trim(),
    event_type: form.event_type,
    level: Math.min(5, Math.max(0, Number(form.level) || 1)),
    max_confidence: form.max_confidence === '' ? null : Number(form.max_confidence),
    conditions: form.conditions.filter((c) => c.field),
    actions: form.actions.filter((a) => a.kind)
  });

  const save = async () => {
    const body = sanitize();
    if (!body.name) return toast('Rule name required', 'err');
    if (body.actions.length === 0) return toast('At least one action required', 'err');
    try {
      if (body.id) { await api.put('/api/v3/automation/rules', body); toast('Rule updated'); }
      else { await api.post('/api/v3/automation/rules', body); toast('Rule created'); }
      setForm({ id: null, name: '', event_type: '*', level: 1, max_confidence: '', conditions: [], actions: [] });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const toggle = async (r) => {
    try {
      await api.post(`/api/v3/automation/rules/${r.id}/toggle`, { enabled: !r.enabled });
      setRules((prev) => prev.map((x) => x.id === r.id ? { ...x, enabled: !r.enabled ? 1 : 0 } : x));
      toast(`${r.name} ${!r.enabled ? 'enabled' : 'disabled'}`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const edit = (r) => {
    let conditions = [], actions = [];
    try { conditions = JSON.parse(r.conditions || '[]'); } catch (_) {}
    try { actions = JSON.parse(r.actions || '[]'); } catch (_) {}
    setForm({ id: r.id, name: r.name, event_type: r.event_type, level: r.level, max_confidence: r.max_confidence != null ? String(r.max_confidence) : '', conditions, actions });
  };

  const runNow = async (r) => {
    try {
      const res = await api.post(`/api/v3/automation/rules/${r.id}/run`, { event_type: 'manual.run' });
      if (res && res.skipped) return toast(`Rule skipped (safety override)`, 'info');
      toast(`Run Now: ${r.name} executed`);
      load();
    } catch (e) { toast(e.message || 'Run failed', 'err'); }
  };

  const openForm = () => setForm({ id: null, name: '', event_type: '*', level: 1, max_confidence: '', conditions: [], actions: [] });
  const statusColor = (s) => ({ executed: '#10b981', failed: '#dc2626', skipped: '#eab308' }[s] || 'var(--muted)');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Zap size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Automation Builder</div>
          <div className="page-sub">Define event-driven rules. Level ≥ 4 rules require high trig-confidence and always respect safety overrides.</div>
        </div>
        <button className="btn btn-primary" onClick={openForm}><Plus size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />New Rule</button>
      </div>

      <div className="card">
        <div className="card-title">Rule</div>
        <div style={{ display: 'grid', gridTemplateColumns: '190px 170px 90px 110px 1fr', gap: 10 }}>
          <div>
            <label className="lbl">Name</label>
            <input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Escalate SOS" />
          </div>
          <div>
            <label className="lbl">Event type</label>
            <select className="inp" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Level (0–5)</label>
            <input className="inp" type="number" min="0" max="5" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Max confidence</label>
            <input className="inp" type="number" min="0" max="100" value={form.max_confidence} onChange={(e) => setForm({ ...form, max_confidence: e.target.value })} placeholder="any" />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn btn-green" onClick={save} style={{ padding: '9px 18px' }}>{form.id ? 'Save Changes' : 'Create Rule'}</button>
            {form.id && <button className="btn btn-outline" onClick={openForm} style={{ marginLeft: 8 }}>Cancel</button>}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="card-title" style={{ fontSize: 13 }}>When (conditions)</div>
          {form.conditions.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input className="inp" style={{ width: 160 }} placeholder="payload field" value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} />
              <select className="inp" style={{ width: 100 }} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
                {['eq', 'neq', 'gt', 'lt', 'exists', 'in'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input className="inp" style={{ width: 120 }} placeholder="value" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} />
              <button className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => setForm((f) => ({ ...f, conditions: [...f.conditions, EMPTY_COND()] }))}><Plus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Add condition</button>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="card-title" style={{ fontSize: 13 }}>Then (actions)</div>
          {form.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select className="inp" style={{ width: 180 }} value={a.kind} onChange={(e) => setAct(i, { kind: e.target.value, params: a.params || {} })}>
                {ACTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {a.kind === 'create_incident' && (
                <input className="inp" style={{ width: 160 }} placeholder="incident kind (e.g. sos)" value={a.params.kind || ''} onChange={(e) => setAct(i, { params: { ...a.params, kind: e.target.value } })} />
              )}
              {a.kind === 'recommend' && (
                <input className="inp" style={{ flex: 1 }} placeholder="recommendation text" value={a.params.text || ''} onChange={(e) => setAct(i, { params: { ...a.params, text: e.target.value } })} />
              )}
              {a.kind === 'notify' && (
                <input className="inp" style={{ flex: 1 }} placeholder="notification message" value={a.params.message || ''} onChange={(e) => setAct(i, { params: { ...a.params, message: e.target.value } })} />
              )}
              <button className="btn btn-sm" onClick={() => setForm((f) => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => setForm((f) => ({ ...f, actions: [...f.actions, EMPTY_ACT()] }))}><Plus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Add action</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-title"><ShieldCheck size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Rules</div>
          {loading ? <div className="empty">Loading…</div> : rules.length === 0 ? <div className="empty">No rules defined</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '8px' }}>Name</th><th style={{ padding: '8px' }}>Event</th><th style={{ padding: '8px' }}>Lvl</th><th style={{ padding: '8px' }}>Cond</th><th style={{ padding: '8px' }}>Acts</th><th style={{ padding: '8px' }}>Runs</th><th style={{ padding: '8px' }}>State</th><th style={{ padding: '8px' }}></th>
                </tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{r.name}</td>
                      <td style={{ padding: '8px' }}><span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.event_type}</span></td>
                      <td style={{ padding: '8px' }}>{r.level}</td>
                      <td style={{ padding: '8px' }}>{(() => { try { return JSON.parse(r.conditions || '[]').length; } catch (_) { return 0; } })()}</td>
                      <td style={{ padding: '8px' }}>{(() => { try { return JSON.parse(r.actions || '[]').length; } catch (_) { return 0; } })()}</td>
                      <td style={{ padding: '8px' }}>{r.run_count || 0}</td>
                      <td style={{ padding: '8px' }}>{r.enabled ? <span style={{ color: '#4ade80', fontWeight: 700 }}>ON</span> : <span className="muted">OFF</span>}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => runNow(r)} title="Run this rule now (even if disabled)"><Play size={13} style={{ marginRight: 2, verticalAlign: 'middle' }} />Run Now</button>
                        <button className="btn btn-sm" onClick={() => edit(r)} style={{ marginLeft: 6 }}><ChevronDown size={13} style={{ marginRight: 2, verticalAlign: 'middle' }} />Edit</button>
                        <button className={`btn btn-sm ${r.enabled ? 'btn-danger' : 'btn-green'}`} onClick={() => toggle(r)} style={{ marginLeft: 6 }}><Power size={13} style={{ verticalAlign: 'middle' }} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title"><History size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />Execution History</div>
          {executions.length === 0 ? <div className="empty">No executions recorded yet</div> : (
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {executions.map((x) => (
                <div key={x.id} style={{ padding: '7px 2px', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{x.triggered_by}</span>
                    <span style={{ color: statusColor(x.outcome), fontWeight: 700, textTransform: 'capitalize' }}>{x.outcome}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>Rule #{x.rule_id} · event #{x.event_id || '—'} · {x.created_at}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}