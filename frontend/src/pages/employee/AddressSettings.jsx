import React, { useEffect, useRef, useState } from 'react';
import { api, todayStr } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import AddressPicker from '../../components/AddressPicker';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import { pickLocation } from '../../lib/geo';
import { MAP_LOCATION_RESULT_KEY } from '../shared/LocationPickerPage';
import { MapPin, Loader2, Send, Map, Search, LocateFixed } from 'lucide-react';

/* Employee "My Address".
   Three ways to set a pickup point — full-screen map picker, address search,
   or current location — all of which end with a Confirm on a named address.
   Latitude/longitude keep being submitted with the address (unchanged API),
   so routing and tracking are unaffected; only the display is human-readable. */

const METHOD = { MAP: 'map', SEARCH: 'search', CURRENT: 'current' };
const DRAFT_KEY = 'address-map-draft';

export default function AddressSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const mapReturnToken = useRef(null);
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

  // Result from the full-screen map picker: a popup posts a message, a
  // same-tab webview lands back here and we read sessionStorage instead.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const d = event.data || {};
      if (d.type !== 'GETINROUTE_MAP_LOCATION') return;
      if (mapReturnToken.current && d.returnToken && d.returnToken !== mapReturnToken.current) return;
      if (d.address && d.lat != null && d.lng != null) {
        setPick({ address: d.address, lat: d.lat, lng: d.lng, place_id: d.place_id || '' });
        toast('Location picked on the map — confirm below.');
      }
    };
    window.addEventListener('message', onMessage);
    try {
      const raw = sessionStorage.getItem(MAP_LOCATION_RESULT_KEY);
      if (raw) {
        const result = JSON.parse(raw);
        const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
        if (result && (!draft.returnToken || draft.returnToken === result.returnToken)) {
          mapReturnToken.current = result.returnToken;
          if (result.address && result.lat != null && result.lng != null) {
            setPick({ address: result.address, lat: result.lat, lng: result.lng, place_id: result.place_id || '' });
          }
        }
        sessionStorage.removeItem(MAP_LOCATION_RESULT_KEY);
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch (e) { /* private-mode / disabled storage */ }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const openMapPicker = () => {
    setMethod(METHOD.MAP);
    const token = (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mapReturnToken.current = token;
    const q = new URLSearchParams({ returnToken: token, returnTo: '/app/address', title: 'Select your pickup location' });
    if (pick?.lat != null && pick?.lng != null) {
      q.set('lat', String(pick.lat));
      q.set('lng', String(pick.lng));
      if (pick.address) q.set('address', pick.address);
      if (pick.place_id) q.set('place_id', pick.place_id);
    }
    const url = `/app/map-picker?${q.toString()}`;
    if (window.ReactNativeWebView) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ returnToken: token }));
      window.location.assign(url);
      return;
    }
    const popup = window.open(url, '_blank');
    if (!popup) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ returnToken: token }));
      window.location.assign(url);
    }
  };

  const handleMapPick = async (lat, lng) => {
    const p = await pickLocation(lat, lng);
    if (p) setPick(p);
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
      onClick={() => { if (id === METHOD.MAP) { openMapPicker(); } else { setMethod(id); } }}
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
          <div style={{ fontSize: 12, marginTop: 4 }}>
            <ViewOnMapLink lat={user.home_lat} lng={user.home_lng} address={user.home_address} label="View on Google Maps" />
          </div>
        )}
      </div>

      {pending ? (
        <div className="m-card" style={{ border: '1.5px solid var(--amber)' }}>
          <div className="m-label" style={{ color: 'var(--amber)' }}>⏳ Pending change</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            <b>{pending.new_address}</b>
            {pending.new_lat != null && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <ViewOnMapLink lat={pending.new_lat} lng={pending.new_lng} address={pending.new_address} label="View requested location on Google Maps" />
              </div>
            )}
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

            {method === METHOD.MAP && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
                  Opens the full-screen map: search an address, drag the pin, then tap <b>Confirm location</b>.
                </p>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={openMapPicker} type="button">
                  <Map size={16} /> {pick ? 'Re-open map to adjust' : 'Open map picker'}
                </button>
                {pick && (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <b>Picked:</b> {pick.address}
                    <div style={{ marginTop: 2 }}>
                      <ViewOnMapLink lat={pick.lat} lng={pick.lng} address={pick.address} label="View on Google Maps" />
                    </div>
                  </div>
                )}
              </div>
            )}

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
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <ViewOnMapLink lat={pick.lat} lng={pick.lng} address={pick.address} label="View on Google Maps" />
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
