import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, todayStr } from '../../api';
import { useAuth } from '../../auth';
import { useToast, useInterval } from '../../components/ui';
import { MapPin, ChevronRight, ArrowRight, ArrowLeft, Phone, Clock, Calendar, Bell, Car } from 'lucide-react';
import AnnouncementBanner from '../../components/AnnouncementBanner';

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

function dirLabel(d) { return d === 'toHome' ? 'Logout' : 'Login'; }
function statusLabel(s) {
  return { assigned: 'Vehicle allocated', started: 'Driver started', in_progress: 'On the way', completed: 'Completed', confirmed: 'Scheduled', requested: 'Awaiting approval', cancelled: 'Cancelled' }[s] || 'Vehicle pending';
}

function SwipeBtn({ direction, label, disabled, onComplete }) {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reset = () => { setDx(0); setDragging(false); };
  const onDown = (e) => { if (disabled) return; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); };
  const onMove = (e) => {
    if (!dragging) return;
    const max = trackRef.current.clientWidth - 58;
    const start = thumbRef.current.getBoundingClientRect().left;
    setDx(Math.max(0, Math.min(e.clientX - start, max)));
  };
  const onUp = () => {
    if (!dragging) return;
    const max = trackRef.current.clientWidth - 58;
    if (dx > max * 0.72) { reset(); onComplete(); } else reset();
  };
  const isRight = direction === 'right';
  return (
    <div className="swipe-track" ref={trackRef}>
      <div className="swipe-hint">{isRight ? `Swipe to ${label} →` : `← Swipe to ${label}`}</div>
      <div ref={thumbRef} className={`swipe-thumb ${dragging ? 'dragging' : ''}`}
        style={isRight ? { left: 5 + dx } : { right: 5 + dx, left: 'auto' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {isRight ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
      </div>
    </div>
  );
}

function DayBooker({ config, schedules, onBook, onCancel, busy }) {
  const [date, setDate] = useState(localDateStr());
  const [direction, setDirection] = useState('toOffice');
  const times = direction === 'toOffice' ? (config?.loginTimes || []) : (config?.logoutTimes || []);
  const [slotLabel, setSlotLabel] = useState('');

  useEffect(() => {
    setSlotLabel((prev) => (times.some((t) => t.label === prev) ? prev : (times[0]?.label || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, config]);

  const active = (Array.isArray(schedules) ? schedules : []).find(
    (s) => s.date === date && ['confirmed', 'requested', 'in_progress'].includes(s.status)
  );
  const selected = times.find((t) => t.label === slotLabel) || times[0] || null;
  const isPast = date < localDateStr();

  return (
    <div className="m-card">
      <div className="m-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Calendar size={14} /> Book a cab for a day</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
          <label style={{ fontSize: 12 }}>Date</label>
          <input type="date" value={date} min={localDateStr()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
          <label style={{ fontSize: 12 }}>Direction</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="toOffice">To office (login)</option>
            <option value="toHome">To home (logout)</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 160px' }}>
          <label style={{ fontSize: 12 }}>Shift slot</label>
          <select value={slotLabel} onChange={(e) => setSlotLabel(e.target.value)}>
            {times.length === 0 && <option value="">No slots configured</option>}
            {times.map((t) => <option key={t.label} value={t.label}>{t.label} ({t.time})</option>)}
          </select>
        </div>
      </div>
      {active ? (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Booking for {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: {active.slotLabel || 'Shift'} · {dirLabel(active.direction)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Status: {statusLabel(active.status)} · Pickup: {active.pickup_time || active.login_time || '—'}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={() => onCancel(active.id)}>Cancel booking</button>
        </div>
      ) : (
        <button className="btn btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
          disabled={busy || isPast || !selected || times.length === 0}
          onClick={() => onBook({ dates: [date], direction, startTime: selected?.time || null, slotLabel: selected?.label })}>
          {busy ? 'Booking...' : isPast ? 'Pick a today/future date' : `Book ${selected?.label || ''} for ${date}`}
        </button>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Requests go to your transport admin for approval. You can book any future day.</div>
    </div>
  );
}

export default function EHome() {
  const { user } = useAuth();
  const toast = useToast();
  const [allotment, setAllotment] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [otpInfo, setOtpInfo] = useState(null);
  const [bookingBusy, setBookingBusy] = useState(false);

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
      if (active?.pendingOtp) setOtpInfo({ otp: active.pendingOtp, scheduleId: active.scheduleId }); else setOtpInfo(null);
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
      if (r.pendingConfirmation && r.otp) { setOtpInfo({ otp: r.otp, scheduleId: allotment.scheduleId }); toast('Read the OTP to your driver to complete check-in', 'info'); }
      else toast('Checked in successfully');
      load();
    } catch (e) { toast(e.message || 'Check-in failed', 'err'); }
  };
  const doCheckOut = async () => {
    if (!allotment) return;
    try {
      const pos = await getPos();
      await api.post(`/api/schedules/allotments/${allotment._id}/checkout`, { lat: pos?.lat ?? null, lng: pos?.lng ?? null });
      toast('Checked out successfully'); load();
    } catch (e) { toast(e.message || 'Check-out failed', 'err'); }
  };
  const doSafeDrop = async () => {
    if (!allotment) return;
    try { await api.post('/api/employee/safety/confirm', { scheduleId: allotment.scheduleId }); toast('Safe arrival confirmed'); load(); }
    catch (e) { toast(e.message || 'Could not confirm', 'err'); }
  };
  const doBookDay = async (payload) => {
    setBookingBusy(true);
    try {
      const r = await api.post('/api/schedules', payload);
      if (r && Array.isArray(r.skipped) && r.skipped.length) toast('A booking already exists for that day', 'info');
      else toast('Cab requested — awaiting admin approval');
      load();
    } catch (e) { toast(e.response?.data?.message || 'Booking failed', 'err'); }
    finally { setBookingBusy(false); }
  };
  const doCancel = async (id) => {
    try { await api.del(`/api/schedules/${id}`); toast('Booking cancelled'); load(); }
    catch (e) { toast(e.response?.data?.message || 'Cancel failed', 'err'); }
  };

  const v = allotment?.vehicle || {};
  const d = allotment?.driver || {};
  const ms = allotment?.myStop || {};
  const canCheckIn = ms?.status === 'pending' && allotment?.status !== 'completed' && !otpInfo;
  const canCheckOut = ms?.status === 'picked_up' && allotment?.status !== 'completed';
  const sharingLive = !!allotment?.sharingLive;

  const today = todayStr();
  const upcoming = (schedules || []).filter((s) => s.date >= today && ['confirmed', 'requested', 'in_progress'].includes(s.status))
    .sort((a, b) => (a.date + (a.pickup_time || a.login_time || '')).localeCompare(b.date + (b.pickup_time || b.login_time || '')));
  const nextTrip = allotment || upcoming[0] || null;
  const firstName = (user?.name || 'there').split(' ')[0];
  const empId = user?.emp_id || user?.id || '—';
  const weeklyOff = config?.weeklyOff || [];

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="eh-root">
      <AnnouncementBanner audiences={['employee', 'both']} />

      <div className="eh-hero">
        <div>
          <h2 className="eh-greet">{greet}, {firstName} 👋</h2>
          <div className="eh-sub">Employee ID {empId} · Here's your transport overview.</div>
        </div>
        <Link to="/app/notifications" className="eh-bell" aria-label="Notifications" title="Notifications"><Bell size={18} /></Link>
      </div>

      {/* Summary cards */}
      <div className="eh-summary">
        <div className="eh-sum-card">
          <div className="eh-sum-label">Next Trip</div>
          <div className="eh-sum-value">{nextTrip ? fmtTime(nextTrip.pickup_time || nextTrip.login_time || nextTrip.drop_time || nextTrip.logout_time) : '—'}</div>
          <div className="eh-sum-foot">{nextTrip ? dirLabel(nextTrip.direction) : 'No trip scheduled'}</div>
        </div>
        <div className="eh-sum-card">
          <div className="eh-sum-label">Upcoming</div>
          <div className="eh-sum-value">{upcoming.length} {upcoming.length === 1 ? 'Trip' : 'Trips'}</div>
          <div className="eh-sum-foot">next 7 days</div>
        </div>
        <div className="eh-sum-card">
          <div className="eh-sum-label">Address</div>
          <div className="eh-sum-value" style={{ fontSize: 15 }}>{user?.home_address ? 'On file' : 'Not set'}</div>
          <div className="eh-sum-foot"><Link to="/app/address" className="eh-link">Manage</Link></div>
        </div>
        <div className="eh-sum-card">
          <div className="eh-sum-label">Weekly Off</div>
          <div className="eh-sum-value" style={{ fontSize: 15 }}>{weeklyOff.length ? weeklyOff.join(', ') : '—'}</div>
          <div className="eh-sum-foot">rest days</div>
        </div>
      </div>

      {/* Big Book CTA */}
      <div className="eh-cta">
        <div>
          <div className="eh-cta-title">Need a ride?</div>
          <div className="eh-cta-sub">Plan your next office trip.</div>
        </div>
        <Link to="/app/book" className="eh-cta-btn">+ BOOK A RIDE</Link>
      </div>

      {/* Next trip / live */}
      {allotment ? (
        <div className="eh-trip">
          <div className="eh-trip-head">
            <span className="eh-pill">{dirLabel(allotment.direction)}</span>
            <span className="eh-trip-time">{allotment.slotLabel || ''}</span>
          </div>
          <div className={`eh-status ${allotment.status === 'completed' ? 'muted' : 'ok'}`}><span className="eh-dot" /> {statusLabel(allotment.status)}</div>
          <div className="eh-trip-veh"><Car size={15} /> {v.vehicleNumber || 'Vehicle TBD'} {v.vehicleType ? `· ${v.vehicleType}` : ''}</div>
          <div className="eh-route">
            <div className="eh-route-row"><span className="eh-rdot primary" /> {ms.pickup?.address || 'Pickup point'}</div>
            <div className="eh-route-row"><span className="eh-rdot violet" /> {ms.drop?.address || 'Destination'}</div>
          </div>
          <div className="eh-driver">{d.name ? `${d.name}${d.phone ? ' · ' + d.phone : ''}` : 'Driver assigned soon'}</div>
          <div className="eh-trip-actions">
            <Link to="/app/track" className="btn btn-sm btn-primary">Track vehicle</Link>
            {d.phone ? <a href={`tel:${d.phone.replace(/[^+\d]/g, '')}`} className="btn btn-sm btn-outline"><Phone size={14} /> Call</a> : null}
          </div>
        </div>
      ) : nextTrip ? (
        <div className="eh-trip">
          <div className="eh-trip-head">
            <span className="eh-pill">{dirLabel(nextTrip.direction)}</span>
            <span className="eh-trip-time">{fmtTime(nextTrip.pickup_time || nextTrip.login_time || nextTrip.drop_time || nextTrip.logout_time)}</span>
          </div>
          <div className="eh-trip-date">{new Date(nextTrip.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
          <div className={`eh-status ${statusLabel(nextTrip.status) === 'Scheduled' ? 'ok' : 'warn'}`}><span className="eh-dot" /> {statusLabel(nextTrip.status)}</div>
          <div className="eh-route">
            <div className="eh-route-row"><span className="eh-rdot primary" /> {nextTrip.pickup_point || 'Pickup point'}</div>
            <div className="eh-route-row"><span className="eh-rdot violet" /> {nextTrip.direction === 'toHome' ? 'Home' : 'Office'}</div>
          </div>
          <div className="eh-trip-actions">
            <Link to="/app/schedule" className="btn btn-sm btn-primary">View details</Link>
            <Link to="/app/schedule" className="btn btn-sm btn-outline">Edit / Cancel</Link>
          </div>
        </div>
      ) : (
        <div className="eh-empty">
          <div style={{ fontSize: 40 }}>🚐</div>
          <b>No active ride right now</b>
          <div className="eh-empty-sub">You don't have an upcoming trip. Book one below and it will appear here.</div>
          <Link to="/app/book" className="btn btn-primary" style={{ marginTop: 14 }}>+ Book a Ride</Link>
        </div>
      )}

      {/* Boarding */}
      {allotment && (canCheckIn || canCheckOut || ms?.safeDropEnabled) && (
        <div className="m-card">
          <div className="m-label">Boarding</div>
          {otpInfo && ms?.status === 'pending' && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Read this OTP to your driver</div>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8, color: 'var(--primary)', padding: '8px 0' }}>{otpInfo.otp}</div>
            </div>
          )}
          {canCheckIn && <SwipeBtn direction="right" label="Check-in" disabled={!canCheckIn} onComplete={doCheckIn} />}
          {!canCheckIn && canCheckOut && <SwipeBtn direction="left" label="Check-out" disabled={!canCheckOut} onComplete={doCheckOut} />}
          {ms?.safeDropEnabled && ms?.status === 'completed' && !ms.safeDropConfirmedAt && (
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={doSafeDrop}>I reached home safely</button>
          )}
        </div>
      )}

      {/* Booking */}
      <div id="book" style={{ scrollMarginTop: 80 }}>
        <DayBooker config={config} schedules={schedules} onBook={doBookDay} onCancel={doCancel} busy={bookingBusy} />
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="m-card">
          <div className="m-label">Upcoming trips</div>
          {upcoming.slice(0, 5).map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < Math.min(upcoming.length, 5) - 1 ? '1px solid var(--line)' : 'none' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{new Date(s.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {dirLabel(s.direction)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtTime(s.pickup_time || s.login_time || s.drop_time || s.logout_time)} · {s.direction === 'toHome' ? 'Office → Home' : 'Home → Office'}</div>
              </div>
              <span className={`badge ${['confirmed', 'in_progress', 'assigned', 'started'].includes(s.status) ? 'badge-green' : 'badge-slate'}`}>{statusLabel(s.status)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Get the mobile app */}
      <div className="eh-app-card">
        <div>
          <div className="eh-app-title">GetInRoute Employee App</div>
          <div className="eh-app-sub">Use the mobile app for faster access to your rides, schedules and live trip information.</div>
          <div className="eh-app-badges">
            <span className="eh-app-badge ok">Android App · Available now</span>
            <span className="eh-app-badge soon">iPhone App · Coming Soon</span>
          </div>
        </div>
        <a href="/download/GetInRoute.apk" className="btn btn-primary" download>Download Employee App</a>
      </div>

      {/* Recent */}
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
