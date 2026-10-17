import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { KeyRound, MapPin, Clock, Power, RefreshCw, AlertTriangle } from 'lucide-react';

/* Web twin of the driver duty block in mobile DriverHomeScreen.
 *
 * A driver's operational location is NOT stored at sign-in — it comes from
 * redeeming an Admin/Vendor-issued Invite ID. That starts (or switches) a duty
 * session scoped to one company location; ending the duty clears it. Without a
 * duty the driver has no location-scoped trips to see. */
export default function DDuty() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [duty, setDuty] = useState(null);
  const [dutyLocation, setDutyLocation] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, hist] = await Promise.all([
        api.get('/api/driver/duty').catch(() => null),
        api.get('/api/driver/duty/locations').catch(() => [])
      ]);
      setDuty(d || null);
      const rows = Array.isArray(hist) ? hist : [];
      const match = d ? rows.find((r) => Number(r.id) === Number(d.id)) : null;
      setDutyLocation(match || rows[0] || null);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function redeem(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/api/driver/invite/redeem', { code: code.trim().toUpperCase() });
      setDuty(r.duty || null);
      setCode('');
      setShowForm(false);
      toast('Duty started for this location.', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  }

  async function endDuty() {
    setBusy(true);
    try {
      await api.post('/api/driver/duty/end');
      setDuty(null);
      toast('Duty ended.', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="empty">Loading…</div>;

  const locLabel = dutyLocation
    ? [dutyLocation.location_name, dutyLocation.city_name, dutyLocation.state_name].filter(Boolean).join(' · ')
    : null;

  return (
    <div>
      {/* Duty banner — same information the APK shows at the top of Driver Home. */}
      <div className="m-card" style={duty ? { borderColor: '#22c55e', background: 'rgba(34,197,94,.08)' } : { borderColor: '#f59e0b', background: 'rgba(245,158,11,.08)' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div className="m-label" style={{ marginBottom: 2 }}>Duty status</div>
            <b style={{ fontSize: 17 }}>{duty ? 'On duty' : 'Not on duty'}</b>
            {duty ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                <MapPin size={13} /> {locLabel || `Location #${duty.company_location_id || '—'}`}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Redeem the Invite ID your Admin issued to start working a location.
              </div>
            )}
          </div>
          {duty ? (
            <button className="btn btn-sm" onClick={endDuty} disabled={busy} style={{ background: '#dc2626', color: '#fff' }}>
              <Power size={14} /> End duty
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)} disabled={busy}>
              <KeyRound size={14} /> Enter invite code
            </button>
          )}
        </div>
        {duty && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} /> Started {duty.started_at ? new Date(String(duty.started_at).replace(' ', 'T')).toLocaleString('en-IN') : '—'}
          </div>
        )}
      </div>

      {showForm && !duty && (
        <form className="m-card" onSubmit={redeem}>
          <div className="m-label" style={{ marginBottom: 6 }}>Invite ID</div>
          <div className="row">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="INV-XXXXXXXX" style={{ flex: 1, textTransform: 'uppercase' }} autoFocus />
            <button className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Redeeming…' : 'Start duty'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>One duty at a time. Redeeming a new Invite ID switches you to that location — trips and tracking follow the new location.</span>
          </div>
        </form>
      )}

      <div className="m-card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <div className="m-label" style={{ marginBottom: 2 }}>Duty history</div>
            <b style={{ fontSize: 15 }}>Locations you have worked</b>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
      <DutyHistory />
    </div>
  );
}

function DutyHistory() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get('/api/driver/duty/locations').then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  if (!rows.length) return <div className="empty">No duty sessions yet.</div>;
  return rows.map((r) => (
    <div className="m-card" key={r.id}>
      <div className="row" style={{ alignItems: 'center' }}>
        <MapPin size={16} color={r.active ? '#22c55e' : 'var(--muted)'} />
        <div style={{ flex: 1 }}>
          <b>{[r.location_name, r.city_name, r.state_name].filter(Boolean).join(' · ') || `Location #${r.company_location_id || '—'}`}</b>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {r.started_at ? new Date(String(r.started_at).replace(' ', 'T')).toLocaleString('en-IN') : '—'}
            {r.ended_at ? ` → ${new Date(String(r.ended_at).replace(' ', 'T')).toLocaleString('en-IN')}` : ''}
          </div>
        </div>
        <span className={`badge ${r.active ? 'badge-green' : 'badge-slate'}`}>{r.active ? 'active' : 'ended'}</span>
      </div>
    </div>
  ));
}
