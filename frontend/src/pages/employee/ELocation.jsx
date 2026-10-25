import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import { Building2, Clock, X, ChevronRight, RefreshCw } from 'lucide-react';
import ViewOnMapLink from '../../components/ViewOnMapLink';

/* Web twin of mobile EmployeeLocationPickerScreen.
 *
 * First-time (no company_location_id yet): picking a location is applied
 * immediately — the admin side auto-confirms a first selection.
 * Afterwards: every move is a location-change REQUEST that the destination
 * admin must approve, and the employee stays on the CURRENT location until
 * it is approved. A pending request can be cancelled. */
export default function ELocation() {
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [locations, setLocations] = useState([]);
  const [currentLocationId, setCurrentLocationId] = useState(null);
  const [pending, setPending] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [info, reqs] = await Promise.all([
        api.post('/api/auth/employee-locations', { identifier: user.email }),
        api.get('/api/employee/location-change-requests/me').catch(() => [])
      ]);
      setCompany(info.company || null);
      setLocations(Array.isArray(info.locations) ? info.locations : []);
      setCurrentLocationId(info.current_location_id != null ? Number(info.current_location_id) : null);
      const rows = Array.isArray(reqs) ? reqs : (reqs && reqs.requests) || [];
      setPending(rows.find((r) => r.status === 'pending') || null);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  }, [user && user.email]);

  useEffect(() => { load(); }, [load]);

  async function pick(loc) {
    const id = Number(loc.id);
    if (currentLocationId != null && id === currentLocationId) {
      toast('You are already at this location.', 'err');
      return;
    }
    if (pending) {
      toast('You already have a pending location-change request. Cancel it first or wait for a decision.', 'err');
      return;
    }
    setBusyId(id);
    try {
      await api.post('/api/employee/location-change-requests', { to_location_id: id, reason: '' });
      toast(`Request sent for ${loc.name}. You stay on your current location until it is approved.`, 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'err');
    } finally { setBusyId(null); }
  }

  async function cancelPending() {
    if (!pending) return;
    setBusyId(Number(pending.id));
    try {
      await api.post(`/api/employee/location-change-requests/${pending.id}/cancel`);
      toast('Request cancelled.', 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'err');
    } finally { setBusyId(null); }
  }

  if (loading) return <div className="empty">Loading…</div>;

  // Group State -> City exactly like the APK.
  const grouped = {};
  for (const l of locations) {
    const key = `${l.state || '?'}||${l.city || '?'}`;
    if (!grouped[key]) grouped[key] = { state: l.state || '?', city: l.city || '?', items: [] };
    grouped[key].items.push(l);
  }
  const groups = Object.values(grouped);
  const isFirstTime = currentLocationId == null;

  return (
    <div>
      <div className="m-card">
        <div>
          <div className="m-label" style={{ marginBottom: 2 }}>Company location</div>
          <b style={{ fontSize: 18 }}>
            {company && company.name ? `Pick the ${company.name} location you belong to.` : 'Pick the company location you belong to.'}
          </b>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {isFirstTime && (
        <div className="m-card" style={{ borderColor: 'var(--primary)', background: 'rgba(37,99,235,.06)' }}>
          <b style={{ fontSize: 13 }}>First-time selection</b>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
            Pick the location you work out of. Later changes need admin approval.
          </div>
        </div>
      )}

      {pending && (
        <div className="m-card" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,.08)' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Clock size={18} color="#f59e0b" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13, textTransform: 'uppercase' }}>Location change pending</b>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                You are still at your CURRENT location. Until your destination admin approves, all your bookings, trips,
                check-ins and notifications go to your current location only.
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>
                To: <b>{pending.to ? `${pending.to.name} (${pending.to.city}, ${pending.to.state})` : '—'}</b>
              </div>
              <button className="btn btn-sm" onClick={cancelPending} disabled={busyId != null}
                style={{ marginTop: 10, background: '#dc2626', color: '#fff' }}>
                <X size={14} /> Cancel request
              </button>
            </div>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty">
          Your company has not added any locations yet. Ask your admin to add one in Operations → Company Address.
        </div>
      ) : groups.map((g) => (
        <div key={g.state + g.city}>
          <div className="m-label" style={{ margin: '14px 0 8px' }}>{g.state} · {g.city}</div>
          {g.items.map((loc) => {
            const isCurrent = currentLocationId != null && Number(loc.id) === currentLocationId;
            return (
              <div className="m-card" key={loc.id} style={isCurrent ? { borderColor: 'var(--primary)' } : null}>
                <div className="row" style={{ alignItems: 'center' }}>
                  <Building2 size={18} color={isCurrent ? 'var(--primary)' : 'var(--muted)'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{loc.name}{isCurrent ? '  (current)' : ''}</b>
                    {loc.address ? (
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {loc.address}
                        {loc.lat != null && loc.lng != null && (
                          <> · <ViewOnMapLink lat={loc.lat} lng={loc.lng} address={loc.address} label="View on Google Maps" /></>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <button className="btn btn-ghost btn-sm" disabled={isCurrent || busyId != null} onClick={() => pick(loc)}>
                    {busyId === Number(loc.id) ? 'Sending…' : isCurrent ? 'Selected' : 'Select'}
                    {!isCurrent && <ChevronRight size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
