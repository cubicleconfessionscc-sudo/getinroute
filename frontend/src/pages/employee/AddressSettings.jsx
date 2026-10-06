import React, { useEffect, useState } from 'react';
import { api, todayStr } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import MapPicker from '../../components/MapPicker';
import { reverseGeocode } from '../../lib/geo';
import { MapPin, Loader2, Send, Map, Search, LocateFixed } from 'lucide-react';

const METHOD = { MAP: 'map', SEARCH: 'search', CURRENT: 'current' };

export default function AddressSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [updates, setUpdates] = useState([]);
  const [pick, setPick] = useState(null);
  const [manual, setManual] = useState('');
  const [method, setMethod] = useState(METHOD.MAP);
  const [locating, setLocating] = useState(false);
  const [sending, setSending] = useState(false);

  const load = () => {
    api.get('/api/me/address-updates').then((r) => setUpdates(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { void load(); }, [user]);

  const pending = updates.find((u) => u.status === 'pending');

  const handleMapPick = async (lat, lng) => {
    let address = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    try {
      const rev = await reverseGeocode(lat, lng);
      if (rev && rev.address) address = rev.address;
    } catch (_) {}
    setPick({ lat, lng, address });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', 'err');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        await handleMapPick(p.coords.latitude, p.coords.longitude);
        setMethod(METHOD.MAP);
        setLocating(false);
        toast('Location captured — confirm below.');
      },
      () => { setLocating(false); toast('Could not get your location. Allow location access or pick on the map.', 'err'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  const submit = async () => {
    const address = pick?.address || manual.trim();
    if (!address) return toast('Select on the map, search, use your location, or type an address.', 'err');
    setSending(true);
    try {
      const r = await api.post('/api/me/address-update', {
        newAddress: address,
        lat: pick?.lat ?? null,
        lng: pick?.lng ?? null
      });
      toast(r.message || 'Address change submitted for approval');
      setPick(null); setManual(''); load();
    } catch (e) { toast(e.message || e.response?.data?.error || 'Submission failed', 'err'); }
    finally { setSending(false); }
  };

  const statusBadge = (s) => ({
    pending: ['badge-violet', 'Awaiting approval'],
    approved: ['badge-green', 'Approved'],
    corrected: ['badge-blue', 'Updated with correction'],
    dismissed: ['badge-slate', 'Dismissed'],
    rejected: ['badge-slate', 'Rejected']
  }[s] || ['badge-slate', s]);

  const MethodBtn = ({ id, icon, label }) => (
    <button
      className={`addr-method ${method === id ? 'on' : ''}`}
      onClick={() => setMethod(id)}
      type="button"
    >
      {icon} <span>{label}</span>
    </button>
  );

  return (
    <div>
      <div className="eh-hero">
        <div>
          <h2 className="eh-greet">My Address</h2>
          <div className="eh-sub">Set where the cab should pick you up. This is the same location your app, admin and vendor see.</div>
        </div>
      </div>

      <div className="m-card">
        <div className="m-label"><MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Current pickup address</div>
        <div style={{ fontSize: 14, marginTop: 6, fontWeight: 600 }}>{user?.home_address || 'No address on file yet'}</div>
        {user?.home_lat != null && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            📍 {Number(user.home_lat).toFixed(5)}, {Number(user.home_lng).toFixed(5)}
          </div>
        )}
      </div>

      {pending ? (
        <div className="m-card" style={{ border: '1.5px solid var(--amber)' }}>
          <div className="m-label" style={{ color: 'var(--amber)' }}>⏳ Pending change</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            <b>{pending.new_address}</b>
            {pending.new_lat != null && <div className="muted" style={{ fontSize: 12 }}>📍 {Number(pending.new_lat).toFixed(5)}, {Number(pending.new_lng).toFixed(5)}</div>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            You cannot book a cab until the transport team approves it.
          </div>
        </div>
      ) : (
        <>
          <div className="m-card">
            <div className="m-label">Pickup point — choose a method</div>
            <div className="addr-methods">
              <MethodBtn id={METHOD.MAP} icon={<Map size={16} />} label="Select on Map" />
              <MethodBtn id={METHOD.SEARCH} icon={<Search size={16} />} label="Search / Enter Address" />
              <MethodBtn id={METHOD.CURRENT} icon={<LocateFixed size={16} />} label="Set to My Location" />
            </div>

            {method === METHOD.SEARCH && (
              <div style={{ marginTop: 12 }}>
                <AddressPicker value={pick} onChange={(item) => setPick(item)} />
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>or type it manually:</div>
                <textarea
                  rows={2}
                  placeholder="Full address, e.g. 42, 5th Cross, Indiranagar, Bengaluru 560038"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </div>
            )}

            {method === METHOD.MAP && (
              <div style={{ marginTop: 12 }}>
                <MapPicker
                  lat={pick?.lat ?? null}
                  lng={pick?.lng ?? null}
                  height={280}
                  label="Tap the map or drag the pin to set your pickup point."
                  onPick={handleMapPick}
                />
              </div>
            )}

            {method === METHOD.CURRENT && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={useMyLocation} disabled={locating} type="button">
                  {locating ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <LocateFixed size={16} />} {locating ? 'Locating…' : 'Use my current location'}
                </button>
              </div>
            )}
          </div>

          {(pick || manual.trim()) && (
            <div className="m-card" style={{ border: '1.5px solid var(--primary)' }}>
              <div className="m-label">Selected location</div>
              <div style={{ fontSize: 14, marginTop: 6, fontWeight: 600 }}>{pick?.address || manual.trim()}</div>
              {pick?.lat != null && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  Latitude: {Number(pick.lat).toFixed(5)} · Longitude: {Number(pick.lng).toFixed(5)}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} disabled={sending} onClick={submit}>
                {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />} {sending ? 'Submitting…' : 'Confirm Location & Submit for Approval'}
              </button>
            </div>
          )}

          {updates.length > 0 && (
            <div className="m-card">
              <div className="m-label">Address request history</div>
              {updates.slice(0, 6).map((u) => {
                const [cls, txt] = statusBadge(u.status);
                return (
                  <div key={u.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.new_address}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.reviewed_at ? `reviewed ${u.reviewed_at}` : 'submitted ' + (u.created_at || todayStr())}</div>
                    </div>
                    <span className={`badge ${cls}`} style={{ whiteSpace: 'nowrap' }}>{txt}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
