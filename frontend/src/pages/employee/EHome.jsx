import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, todayStr } from '../../api';
import { useToast, useInterval } from '../../components/ui';
import { MapPin, ChevronRight, ArrowRight, ArrowLeft, Phone, Car, Clock } from 'lucide-react';

function SwipeBtn({ direction, label, disabled, onComplete }) {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => { setDx(0); setDragging(false); };

  const onDown = (e) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e) => {
    if (!dragging) return;
    const max = trackRef.current.clientWidth - 58;
    const start = thumbRef.current.getBoundingClientRect().left;
    const diff = e.clientX - start;
    setDx(Math.max(0, Math.min(diff, max)));
  };
  const onUp = () => {
    if (!dragging) return;
    const max = trackRef.current.clientWidth - 58;
    if (dx > max * 0.72) { reset(); onComplete(); }
    else reset();
  };

  const isRight = direction === 'right';
  return (
    <div className="swipe-track" ref={trackRef}>
      <div className="swipe-hint">{isRight ? `Swipe to ${label} →` : `← Swipe to ${label}`}</div>
      <div
        ref={thumbRef}
        className={`swipe-thumb ${dragging ? 'dragging' : ''}`}
        style={isRight ? { left: 5 + dx } : { right: 5 + dx, left: 'auto' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        {isRight ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
      </div>
    </div>
  );
}

export default function EHome() {
  const toast = useToast();
  const [allotment, setAllotment] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [otpInfo, setOtpInfo] = useState(null);

  const getPos = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
    );
  });

  const load = () => {
    api.get('/api/schedules/allotments/live').then((list) => {
      const active = (Array.isArray(list) ? list : []).find((a) => a.status === 'assigned' || a.status === 'started') || null;
      setAllotment(active);
      if (active?.driverLocation) setDriverLocation(active.driverLocation);
      if (active?.pendingOtp) setOtpInfo({ otp: active.pendingOtp, scheduleId: active.scheduleId });
      else setOtpInfo(null);
    }).catch(() => {});
    api.get('/api/schedules/mine').then((r) => setSchedules(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/api/schedules/config').then((r) => setConfig(r && typeof r === 'object' ? r : null)).catch(() => {});
    api.get('/api/trips/history').then((r) => setHistory(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 10000);

  const doCheckIn = async () => {
    if (!allotment) return;
    try {
      const pos = await getPos();
      const r = await api.post(`/api/schedules/allotments/${allotment._id}/checkin`, { lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      if (r.pendingConfirmation && r.otp) {
        setOtpInfo({ otp: r.otp, scheduleId: allotment.scheduleId });
        toast('Read the OTP to your driver to complete check-in', 'info');
      } else {
        toast('Checked in successfully');
      }
      load();
    } catch (e) { toast(e.message || 'Check-in failed', 'err'); }
  };

  const doCheckOut = async () => {
    if (!allotment) return;
    try {
      const pos = await getPos();
      await api.post(`/api/schedules/allotments/${allotment._id}/checkout`, { lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      toast('Checked out successfully');
      load();
    } catch (e) { toast(e.message || 'Check-out failed', 'err'); }
  };

  const doSafeDrop = async () => {
    if (!allotment) return;
    try {
      await api.post('/api/employee/safety/confirm', { scheduleId: allotment.scheduleId });
      toast('Safe arrival confirmed');
      load();
    } catch (e) { toast(e.message || 'Could not confirm', 'err'); }
  };

  const doNotReached = async () => {
    if (!allotment) return;
    if (!window.confirm('This will alert your transport team that you have NOT reached home safely. Continue?')) return;
    try {
      const pos = await getPos();
      const r = await api.post('/api/employee/safety/not-reached', { scheduleId: allotment.scheduleId, lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      toast(r.message || 'Help request sent');
      load();
    } catch (e) { toast(e.message || 'Could not send', 'err'); }
  };

  const doBook = async (slotLabel, direction) => {
    try {
      await api.post('/api/schedules', { slotLabel, direction });
      toast('Cab booked!');
      load();
    } catch (e) { toast(e.response?.data?.message || 'Booking failed', 'err'); }
  };

  const doCancel = async (id) => {
    try {
      await api.del(`/api/schedules/${id}`);
      toast('Booking cancelled');
      load();
    } catch (e) { toast(e.response?.data?.message || 'Cancel failed', 'err'); }
  };

  const v = allotment?.vehicle || {};
  const d = allotment?.driver || {};
  const ms = allotment?.myStop || {};
  const canCheckIn = ms?.status === 'pending' && allotment?.status !== 'completed' && !otpInfo;
  const canCheckOut = ms?.status === 'picked_up' && allotment?.status !== 'completed';
  const sharingLive = !!allotment?.sharingLive;

  const todayConfirmed = schedules.find((s) => s.date === todayStr() && s.status === 'confirmed');

  return (
    <div>
      {allotment ? (
        <>
          <div className="m-card">
            <div className="m-label">Your cab</div>
            <div className="row" style={{ alignItems: 'center' }}>
              <div style={{ fontSize: 30 }}>🚐</div>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 15 }}>{v.vehicleNumber || 'Vehicle TBD'} · {v.vehicleType || ''}</b>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {v.line ? `Line ${v.line}` : ''}
                  {allotment.myOrder != null && allotment.total ? ` · Cab ${allotment.myOrder} of ${allotment.total}` : ''}
                  {allotment._id ? ` · Trip ${String(allotment._id).slice(-6).toUpperCase()}` : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 4 }}>
                  {d.name ? `${d.name}` : 'Driver assigned soon'}
                  {d.phone ? ` · ${d.phone}` : ''}
                </div>
              </div>
              {d.phone ? (
                <a href={`tel:${d.phone.replace(/[^+\d]/g, '')}`} className="btn btn-sm btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Phone size={14} /> Call
                </a>
              ) : null}
            </div>
            {allotment._id && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                Trip #{String(allotment._id).slice(-6).toUpperCase()} · {allotment.slotLabel || 'Shift'}
              </div>
            )}
          </div>

          {ms && (ms.pickup?.address || ms.drop?.address) && (
            <div className="m-card">
              <div className="m-label">Your route</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
                {ms.pickup?.address && <span className="chip"><MapPin size={13} /> Pickup: {ms.pickup.address}</span>}
                {ms.drop?.address && <span className="chip">🏁 Drop: {ms.drop.address}</span>}
              </div>
            </div>
          )}

          {allotment.eta && (allotment.eta.minutes != null || allotment.eta.km != null) && (
            <div className="m-card">
              <div className="m-label">Cab ETA</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>
                {allotment.eta.minutes != null ? (allotment.eta.minutes > 0 ? `~${allotment.eta.minutes} min` : 'Arriving now') : '—'}
              </div>
              {allotment.eta.km != null && (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {allotment.eta.km < 1 ? `${Math.round(allotment.eta.km * 1000)} m` : `${allotment.eta.km.toFixed(1)} km`} away
                </div>
              )}
            </div>
          )}

          <div className="m-card">
            <div className="m-label">Drop sequence</div>
            {(Array.isArray(allotment.sequence) ? allotment.sequence : []).map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < (Array.isArray(allotment.sequence) ? allotment.sequence : []).length - 1 ? '1px solid var(--line)' : 'none' }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: s.status === 'completed' ? 'var(--green)' : 'var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: s.status === 'completed' ? '#fff' : 'var(--muted)' }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.isMe ? 'You' : s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.address || s.pickup?.address || '—'}</div>
                </div>
                <span className={`badge ${s.status === 'completed' ? 'badge-green' : s.status === 'picked_up' ? 'badge-blue' : 'badge-slate'}`}>
                  {s.status === 'completed' ? 'Done' : s.status === 'picked_up' ? 'Picked up' : s.status === 'reached' ? 'Reached' : 'Pending'}
                </span>
              </div>
            ))}
          </div>

          <div className="swipe-card">
            <div className="m-label">Boarding status</div>
            {otpInfo && ms?.status === 'pending' && (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <div style={{ fontSize: 30 }}>🎟️</div>
                <b style={{ fontSize: 15 }}>Read this OTP to your driver</b>
                <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8, color: 'var(--primary)', padding: '8px 0' }}>{otpInfo.otp}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  Your driver will enter it in their app to confirm your check-in. This screen refreshes automatically.
                </div>
              </div>
            )}
            {canCheckIn && (
              <div>
                <div style={{ textAlign: 'center', padding: '4px 0' }}>
                  <div style={{ fontSize: 30 }}>🚶</div>
                  <b style={{ fontSize: 15 }}>Waiting for your cab</b>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>When the cab reaches your stop, swipe right to check in.</div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <SwipeBtn direction="right" label="Check-in" disabled={!canCheckIn} onComplete={doCheckIn} />
                </div>
              </div>
            )}
            {!canCheckIn && canCheckOut && (
              <div>
                <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
                  <div style={{ fontSize: 30 }}>✅</div>
                  <b style={{ fontSize: 15 }}>You checked in</b>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Swipe left to check out when you leave the cab.</div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <SwipeBtn direction="left" label="Check-out" disabled={!canCheckOut} onComplete={doCheckOut} />
                </div>
              </div>
            )}
            {!canCheckIn && !canCheckOut && allotment.status === 'completed' && (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <div style={{ fontSize: 30 }}>🎉</div>
                <b style={{ fontSize: 15 }}>Trip complete</b>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Thanks for riding today!</div>
              </div>
            )}
          </div>

          {ms?.safeDropEnabled && ms?.status === 'completed' && (
            <div className="m-card" style={{ border: `1.5px solid ${allotment.safety?.phase === 'alert' ? 'var(--red)' : 'var(--primary)'}` }}>
              <div className="m-label" style={{ color: allotment.safety?.phase === 'alert' ? 'var(--red)' : 'var(--primary)' }}>Night Safety Drop</div>
              {ms.safeDropConfirmedAt ? (
                <div style={{ fontSize: 13 }}>✅ You confirmed reaching home. The transport team is notified.</div>
              ) : allotment.safety?.phase === 'alert' ? (
                <>
                  <div style={{ fontSize: 13, marginBottom: 10 }}>
                    🚨 Help request sent. Your transport team is viewing your live location. If you are actually home, confirm below to close the alert.
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={doSafeDrop}>
                    I'm home — close alert
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, marginBottom: 10 }}>Confirm you reached home safely so the transport team knows you got home OK.</div>
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={doSafeDrop}>
                    I reached home safely
                  </button>
                  <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={doNotReached}>
                    I have NOT reached home — send help
                  </button>
                </>
              )}
            </div>
          )}

          <Link to="/app/track" className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: 24 }}>📍</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>{sharingLive ? 'View live map' : 'View map'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {sharingLive ? 'Driver is sharing their live location' : "Driver hasn't started sharing yet"}
              </div>
            </div>
            <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
          </Link>
        </>
      ) : (
        <div className="m-card">
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🚐</div>
            <b style={{ fontSize: 16 }}>No active ride right now</b>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 18, maxWidth: 340, margin: '6px auto 0' }}>
              Once the admin allots a cab for your shift, your driver's live location and drop position will show up here.
            </div>
          </div>

          {todayConfirmed && (
            <div className="m-card" style={{ border: '1.5px solid var(--primary)', marginTop: 12 }}>
              <div className="m-label">Today's booking</div>
              <div style={{ fontWeight: 600 }}>{todayConfirmed.slotLabel || 'Shift'} · {todayConfirmed.direction === 'toOffice' ? 'Login' : 'Logout'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                <Clock size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Pickup: {todayConfirmed.pickupTime || '—'}
              </div>
              <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => doCancel(todayConfirmed._id)}>
                Cancel booking
              </button>
            </div>
          )}

          {!todayConfirmed && config && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Quick book for today</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(Array.isArray(config.shiftSlots) ? config.shiftSlots : []).slice(0, 4).map((s) => (
                  <button key={s.label} className="btn btn-sm btn-outline" disabled={s.closedForToday} onClick={() => doBook(s.label, 'toOffice')} style={{ fontSize: 12 }}>
                    {s.label} {s.closedForToday ? '(closed)' : '→ Office'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="m-card">
          <div className="m-label">Recent trips</div>
          {history.slice(0, 5).map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--line)' : 'none' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{h.date ? new Date(h.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.vehicle || '—'} · {h.driver || '—'}</div>
              </div>
              <span className={`badge ${h.status === 'completed' ? 'badge-green' : 'badge-slate'}`}>{h.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
