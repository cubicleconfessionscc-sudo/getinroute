import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { Flag, ToggleLeft, ToggleRight } from 'lucide-react';

export default function FeatureFlags() {
  const toast = useToast();
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get('/api/v3/flags').then((r) => { setFlags(Array.isArray(r) ? r : []); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const toggle = async (key, currentEnabled, description) => {
    try {
      await api.put(`/api/v3/flags/${key}`, { enabled: !currentEnabled, description });
      setFlags((prev) => prev.map((f) => f.flag_key === key ? { ...f, enabled: !currentEnabled ? 1 : 0 } : f));
      toast(`Flag ${key} ${!currentEnabled ? 'enabled' : 'disabled'}`);
    } catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <div className="page"><div className="card"><div className="empty">Loading...</div></div></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Flag size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Feature Flags</div>
          <div className="page-sub">Toggle platform features on and off. Changes take effect immediately.</div>
        </div>
      </div>

      <div className="card">
        {flags.length === 0 ? <div className="empty">No feature flags configured</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Flag</th>
                  <th style={{ padding: '10px 12px' }}>Description</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.flag_key} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{f.flag_key}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{f.description || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: f.enabled ? '#4ade80' : 'var(--muted)' }}>
                        {f.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        {f.enabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button className={`btn btn-sm ${f.enabled ? 'btn-danger' : 'btn-green'}`} onClick={() => toggle(f.flag_key, f.enabled, f.description)}>
                        {f.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
