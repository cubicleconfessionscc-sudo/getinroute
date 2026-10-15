import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import { Flag, ToggleLeft, ToggleRight, Building2 } from 'lucide-react';

export default function FeatureFlags() {
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = !!user?.isOwner;
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(''); // '' = platform default
  const [companyFlags, setCompanyFlags] = useState([]);

  const loadPlatform = () => {
    setLoading(true);
    api.get('/api/v3/flags')
      .then((r) => setFlags(Array.isArray(r) ? r : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadPlatform(); }, []);

  useEffect(() => {
    if (!isOwner) return;
    api.get('/api/admin/feature-companies').then((r) => setCompanies(Array.isArray(r) ? r : [])).catch(() => {});
  }, [isOwner]);

  const loadCompany = (id) => {
    if (!id) { setCompanyFlags([]); return; }
    api.get(`/api/admin/company-flags/${id}`).then((r) => setCompanyFlags(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { loadCompany(companyId); }, [companyId]);

  const togglePlatform = async (key, currentEnabled, description) => {
    try {
      await api.put(`/api/v3/flags/${key}`, { enabled: !currentEnabled, description });
      setFlags((prev) => prev.map((f) => f.flag_key === key ? { ...f, enabled: !currentEnabled ? 1 : 0 } : f));
      toast(`Flag ${key} ${!currentEnabled ? 'enabled' : 'disabled'}`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const toggleCompany = async (key, currentEnabled) => {
    if (!companyId) return;
    try {
      await api.put(`/api/admin/company-flags/${companyId}/${key}`, { enabled: !currentEnabled });
      setCompanyFlags((prev) => prev.map((f) => f.flag_key === key ? { ...f, enabled: !currentEnabled ? 1 : 0, override: true } : f));
      toast(`Flag ${key} ${!currentEnabled ? 'enabled' : 'disabled'} for this company`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const clearOverride = async (key) => {
    if (!companyId) return;
    // Clearing = fall back to the platform default by setting it back to that value.
    const base = flags.find((f) => f.flag_key === key);
    const target = !!(base && base.enabled);
    try {
      await api.put(`/api/admin/company-flags/${companyId}/${key}`, { enabled: target });
      setCompanyFlags((prev) => prev.map((f) => f.flag_key === key ? { ...f, enabled: target ? 1 : 0, override: false } : f));
      toast(`Flag ${key} reset to platform default`);
    } catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <div className="page"><div className="card"><div className="empty">Loading...</div></div></div>;

  const rows = companyId ? companyFlags : flags;
  const toggle = companyId ? toggleCompany : togglePlatform;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title"><Flag size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />Feature Flags</div>
          <div className="page-sub">Toggle platform features on and off. Changes take effect immediately.</div>
        </div>
      </div>

      {isOwner && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Building2 size={18} />
            <b style={{ fontSize: 14 }}>Apply for a specific company</b>
            <select
              className="input"
              style={{ maxWidth: 360 }}
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">All companies (platform default)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.email || `Company #${c.id}`}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {companyId ? 'Overrides apply only to this company. Disabled features are hidden in their portal.' : 'Platform default applies to every company unless overridden.'}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? <div className="empty">No feature flags configured</div> : (
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
                {rows.map((f) => (
                  <tr key={f.flag_key} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{f.flag_key}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {f.description || '—'}
                      {companyId && f.override ? <span style={{ marginLeft: 6, color: 'var(--primary)', fontWeight: 700 }}>· company override</span> : null}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: f.enabled ? '#4ade80' : 'var(--muted)' }}>
                        {f.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        {f.enabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                      <button className={`btn btn-sm ${f.enabled ? 'btn-danger' : 'btn-green'}`} onClick={() => toggle(f.flag_key, f.enabled, f.description)}>
                        {f.enabled ? 'Disable' : 'Enable'}
                      </button>
                      {companyId && f.override ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => clearOverride(f.flag_key)}>Use default</button>
                      ) : null}
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
