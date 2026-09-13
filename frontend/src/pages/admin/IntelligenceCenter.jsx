import React, { useState } from 'react';
import { api } from '../../api';
import { useToast, Badge, Modal } from '../../components/ui';
import { Brain, Route, Truck, UserCheck, TrendingUp, Clock, AlertTriangle, DollarSign, Activity, Zap } from 'lucide-react';

function ResultCard({ title, data, onClose }) {
  if (!data) return null;
  const items = typeof data === 'object' ? Object.entries(data) : [['result', data]];
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700 }}>{title}</h4>
        {onClose && <button className="btn btn-sm btn-ghost" onClick={onClose}>×</button>}
      </div>
      <pre style={{ fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

export default function IntelligenceCenter() {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [resultTitle, setResultTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecs, setShowRecs] = useState(false);
  const [recs, setRecs] = useState([]);
  const [showSimulate, setShowSimulate] = useState(false);
  const [simParams, setSimParams] = useState({ scenario: 'peak_day', date: new Date().toISOString().slice(0, 10) });
  const [simResult, setSimResult] = useState(null);

  const run = async (title, url, body = {}) => {
    setLoading(true);
    setResult(null);
    try {
      const r = body && Object.keys(body).length > 0 ? await api.post(url, body) : await api.post(url);
      setResult(r);
      setResultTitle(title);
    } catch (e) { toast(e.message, 'err'); }
    setLoading(false);
  };

  const loadRecs = async () => {
    try {
      const r = await api.get('/api/v3/ai/recommendations');
      setRecs(Array.isArray(r) ? r : []);
      setShowRecs(true);
    } catch (e) { toast(e.message, 'err'); }
  };

  const approveRec = async (id, decision) => {
    try {
      await api.post(`/api/v3/ai/approve/${id}`, { decision });
      toast(`Recommendation ${decision.toLowerCase()}`);
      loadRecs();
    } catch (e) { toast(e.message, 'err'); }
  };

  const runSimulate = async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/v3/ai/simulate', simParams);
      setSimResult(r);
    } catch (e) { toast(e.message, 'err'); }
    setLoading(false);
  };

  const tools = [
    { label: 'Route Optimization', icon: Route, color: '#4f46e5', desc: 'Analyze and optimize route assignments', action: () => run('Route Optimization', '/api/v3/ai/recommendations', {}) },
    { label: 'Vehicle Allocation', icon: Truck, color: '#7c3aed', desc: 'Intelligent vehicle-route matching', action: () => run('Vehicle Allocation', '/api/v3/ai/vehicle/allocate', {}) },
    { label: 'Driver Allocation', icon: UserCheck, color: '#2563eb', desc: 'Optimal driver-vehicle assignment', action: () => run('Driver Allocation', '/api/v3/ai/driver/allocate', {}) },
    { label: 'Demand Analysis', icon: TrendingUp, color: '#059669', desc: 'Analyze transport demand patterns', action: () => run('Demand Analysis', '/api/v3/ai/demand', { days: 30 }) },
    { label: 'Safety Scan', icon: AlertTriangle, color: '#dc2626', desc: 'Comprehensive safety compliance check', action: () => run('Safety Scan', '/api/v3/ai/safety', { date: new Date().toISOString().slice(0, 10) }) },
    { label: 'Cost Intelligence', icon: DollarSign, color: '#ca8a04', desc: 'Transport cost breakdown and insights', action: () => run('Cost Intelligence', '/api/v3/ai/cost', { days: 30 }) },
    { label: 'Anomaly Detection', icon: Activity, color: '#e11d48', desc: 'Detect unusual patterns and outliers', action: () => run('Anomaly Detection', '/api/v3/ai/anomaly', { date: new Date().toISOString().slice(0, 10) }) },
    { label: 'Root Cause Analysis', icon: Brain, color: '#6366f1', desc: 'Diagnose causes of service issues', action: () => run('Root Cause Analysis', '/api/v3/ai/root-cause', {}) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Brain size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Intelligence Center</div>
          <div className="page-sub">AI-powered transport intelligence. All recommendations require approval before execution.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={loadRecs}><Zap size={14} /> Recommendations</button>
          <button className="btn btn-outline btn-sm" onClick={() => setShowSimulate(true)}><Clock size={14} /> Simulate</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.label} className="card" style={{ textAlign: 'left', cursor: 'pointer', borderLeft: `4px solid ${t.color}`, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={t.action}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Icon size={20} style={{ color: t.color }} />
                <div style={{ fontSize: 14, fontWeight: 700 }}>{t.label}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.desc}</div>
            </button>
          );
        })}
      </div>

      {loading && <div className="card"><div className="empty">Running analysis...</div></div>}

      {result && <ResultCard title={resultTitle} data={result} onClose={() => setResult(null)} />}

      <Modal open={showRecs} title="AI Recommendations" onClose={() => setShowRecs(false)} wide>
        <div style={{ padding: 16 }}>
          {recs.length === 0 ? <div className="empty">No pending recommendations</div> : recs.map((r) => (
            <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.recommendation_type || r.type || 'Recommendation'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.reason || 'No reason provided'}</div>
                  {r.confidence != null && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Confidence: {r.confidence}%</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-green" onClick={() => approveRec(r.id, 'APPROVED')}>Approve</button>
                  <button className="btn btn-sm btn-danger" onClick={() => approveRec(r.id, 'REJECTED')}>Reject</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={showSimulate} title="Digital Twin Simulation" onClose={() => { setShowSimulate(false); setSimResult(null); }} wide>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Scenario</label>
              <select value={simParams.scenario} onChange={(e) => setSimParams({ ...simParams, scenario: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
                <option value="peak_day">Peak Day</option>
                <option value="holiday">Holiday</option>
                <option value="rainy">Rainy Day</option>
                <option value="vehicle_breakdown">Vehicle Breakdown</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date</label>
              <input type="date" value={simParams.date} onChange={(e) => setSimParams({ ...simParams, date: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={loading} onClick={runSimulate}>{loading ? 'Running...' : 'Run Simulation'}</button>
          {simResult && <ResultCard title="Simulation Result" data={simResult} />}
        </div>
      </Modal>
    </div>
  );
}
