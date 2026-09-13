import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { ShieldCheck, Save } from 'lucide-react';

const DEFAULT_POLICY_META = {
  max_occupancy: { type: 'number', desc: 'Maximum vehicle occupancy' },
  night_safety_enabled: { type: 'boolean', desc: 'Night transport safety policy' },
  night_safety_start: { type: 'string', desc: 'Night safety window start' },
  night_safety_end: { type: 'string', desc: 'Night safety window end' },
  max_driver_shift_hours: { type: 'number', desc: 'Maximum continuous driver shift (hours)' },
  pickup_window_minutes: { type: 'number', desc: 'Pickup time window (minutes)' },
  ai_auto_approval_confidence: { type: 'number', desc: 'Confidence threshold for auto-approval' },
  ai_auto_approval_max_impact: { type: 'string', desc: 'Max impact level for auto-approval (low|medium)' },
  document_blocking_enabled: { type: 'boolean', desc: 'Block assignment when mandatory docs expired' },
  grace_period_days: { type: 'number', desc: 'Subscription grace period (days)' }
};

export default function PolicyEngine() {
  const toast = useToast();
  const [policies, setPolicies] = useState([]);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/api/v3/policies').then((r) => {
      const list = Array.isArray(r) ? r : [];
      setPolicies(list);
      const e = {};
      list.forEach((p) => { e[p.rule_key] = p.value || ''; });
      setEdits(e);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const saveAll = async () => {
    setSaving(true);
    try {
      const promises = Object.entries(edits).map(([key, value]) => {
        const meta = DEFAULT_POLICY_META[key] || { type: 'string' };
        return api.put('/api/v3/policies', { key, value, type: meta.type, name: key });
      });
      await Promise.all(promises);
      toast('Policies saved');
      load();
    } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
  };

  if (loading) return <div className="page"><div className="card"><div className="empty">Loading...</div></div></div>;

  const allKeys = [...new Set([...policies.map((p) => p.rule_key), ...Object.keys(DEFAULT_POLICY_META)])];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><ShieldCheck size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Policy Engine</div>
          <div className="page-sub">Configure operational and safety policies. Changes apply to all routes and schedules.</div>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={saveAll}><Save size={14} /> {saving ? 'Saving...' : 'Save All'}</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
        {allKeys.map((key) => {
          const meta = DEFAULT_POLICY_META[key] || { type: 'string', desc: key };
          const existing = policies.find((p) => p.rule_key === key);
          return (
            <div key={key} className="card">
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{meta.type}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{meta.desc}</div>
              {existing && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  Scope: {existing.company_id ? `Company #${existing.company_id}` : 'Platform-wide'} · Vertical: {existing.vertical || 'company'}
                </div>
              )}
              {meta.type === 'boolean' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn btn-sm ${(edits[key] === 'true' || edits[key] === '1') ? 'btn-primary' : 'btn-outline'}`} onClick={() => setEdits({ ...edits, [key]: 'true' })}>Enabled</button>
                  <button className={`btn btn-sm ${(edits[key] !== 'true' && edits[key] !== '1') ? 'btn-danger' : 'btn-outline'}`} onClick={() => setEdits({ ...edits, [key]: 'false' })}>Disabled</button>
                </div>
              ) : (
                <input value={edits[key] || ''} onChange={(e) => setEdits({ ...edits, [key]: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
