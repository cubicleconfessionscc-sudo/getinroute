import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast, useInterval, Badge } from '../../components/ui';
import { useSocketEvent } from '../../socket';
import { Play, Square, ChevronRight, Users, MapPin, MessageCircle, BellRing, Navigation } from 'lucide-react';

const LIVE = [
  { key: 'en_route', label: 'En route' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'dropping', label: 'Dropping' },
  { key: 'completed', label: 'Done' }
];

export default function DHome() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [sending, setSending] = useState(false);
  const [otpMap, setOtpMap] = useState({});
  const [standInput, setStandInput] = useState('');
  const load = () => api.get('/api/driver/today').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 5000);
  useSocketEvent('run:nextStop', () => load());

  const currentStand = () => String(standInput ? standInput : (data?.vehicle?.stand || '')).trim().toUpperCase();

  const setStand = async () => {
    const v = currentStand();
    if (!/^L(?:[1-9]|[1-5][0-9]|60)$/.test(v)) return toast('Enter a stand slot like L12 (L1 to L60).', 'err');
    try {
      const r = await api.put('/api/driver/standing-point', { standingPoint: v });
      toast(r?.standingPoint ? `Stand set to ${r.standingPoint}` : 'Stand updated');
      setStandInput('');
      load();
    } catch (e) { toast(e.message || 'Could not update stand', 'err'); }
  };

  const reportParkingLine = async () => {
    const v = currentStand();
    if (!/^L(?:[1-9]|[1-5][0-9]|60)$/.test(v)) return toast('Set a stand slot first (L1 to L60).', 'err');
    try {
      const r = await api.post('/api/driver/parking-line', { line: v });
      toast(r?.line ? `Parking line reported · ${r.line}` : 'Parking line reported');
      setStandInput('');
      load();
    } catch (e) { toast(e.message || 'Could not report parking line', 'err'); }
  };

  if (!data) return <div className="m-card"><div className="empty">No vehicle assigned to you yet.</div></div>;
  if (!data.route) return <div className="m-card"><div className="empty">No route assigned to your vehicle yet. Admin will allocate one.</div></div>;

  const onTrip = data.vehicle?.status === 'active';
  const schoolMode = data.vehicle?.vertical === 'school';
  const safeSchedules = Array.isArray(data.schedules) ? data.schedules : [];
  const checkedInCount = safeSchedules.filter((s) => Array.isArray(s.checkins) && s.checkins.some((c) => c.type === 'checkin')).length;
  const sequenceLen = safeSchedules.length;

  const tripAction = async (action) => {
    try {
      const r = await api.post('/api/driver/trip', { action });
      toast(r.message);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const setStatus = async (status) => {
    try {
      const r = await api.put('/api/driver/status', { status });
      toast(`Status: ${status.replace(/_/g, ' ')}`);
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const notifyPassengers = async () => {
    setSending(true);
    try {
      const r = await api.post('/api/driver/notify-passengers', { message: 'Your cab is on the way. Please be ready at your pickup stop.' });
      toast(`SMS sent to ${r.notified} passenger${r.notified === 1 ? '' : 's'}`);
    } catch (e) { toast(e.message, 'err'); }
    setSending(false);
  };

  const studentAction = async (sid, action) => {
    try {
      const r = await api.post(`/api/driver/student/${sid}/${action}`);
      toast(r.message + (r.otp_required ? ' — parent OTP sent' : ''));
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const confirmOtp = async (s) => {
    const v = String(otpMap[s.id] || '').trim();
    if (v.length !== 6) return toast('Enter the 6-digit OTP the passenger read out to you.', 'err');
    try {
      const r = await api.post('/api/driver/confirm-checkin', { scheduleId: s.id, otp: v });
      toast(r.message || 'Check-in confirmed');
      setOtpMap((m) => ({ ...m, [s.id]: '' }));
      load();
    } catch (e) { toast(e.message || 'Could not confirm check-in', 'err'); }
  };

  const isStudent = (s) => s.vertical === 'school';
  const studentStatus = (s) => {
    if (s.drop_confirmed) return { t: 'Dropped', c: 'green' };
    if (s.dropped_at && s.drop_otp) return { t: 'Awaiting OTP', c: 'amber' };
    if (s.absent) return { t: 'Absent', c: 'red' };
    if (s.boarded_at) return { t: 'Boarded', c: 'blue' };
    return { t: 'Pending', c: 'slate' };
  };

  return (
    <div>
      <div className="m-card">
        <div className="m-label">Today's route</div>
        <h2>{data.route.name}</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
          <span className="chip"><MapPin size={13} /> {safeSchedules.length} pickups</span>
          <span className="chip"><Users size={13} /> {checkedInCount} onboard</span>
          <span className="chip">🛑 {Array.isArray(data.route.stops) ? data.route.stops.length : 0} stops</span>
        </div>
        <div className="progress-strip">
          {(Array.isArray(data.route.stops) ? data.route.stops : []).map((s, i) => (
            <div key={s.sequence} className={`seg ${i < Math.max(0, sequenceLen - 1) ? 'done' : i === Math.max(0, sequenceLen - 1) ? 'now' : ''}`} />
          ))}
        </div>
      </div>

      <div className="m-card">
        <div className="m-label">My cab position</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
          <span className="chip"><MapPin size={13} /> {data.vehicle?.vehicle_name || 'My cab'}</span>
          {data.vehicle.plate && <span className="chip">{data.vehicle.plate}</span>}
          {data.vehicle.stand
            ? <span className="chip">Stand {data.vehicle.stand}</span>
            : <span className="chip">Stand not set</span>}
          {(data.vehicle.line || data.vehicle.trip) && <span className="chip">Line {data.vehicle.line || '—'} · Trip #{data.vehicle.trip || '—'}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={standInput}
            onChange={(e) => setStandInput(e.target.value.toUpperCase().replace(/[^L0-9]/g, '').slice(0, 3))}
            placeholder="L12"
            aria-label="Stand slot"
            style={{ width: 88, textAlign: 'center', fontSize: 16, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--font-mono)' }}
          />
          <button className="btn btn-outline" onClick={setStand}>Set stand</button>
          <button className="btn btn-outline" onClick={reportParkingLine}>Report parking line</button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Slots L1–L60. &quot;Report parking line&quot; logs an entry for the yard manager.</span>
        </div>
      </div>

      <div className="m-card">
        <div className="m-label">Trip control</div>
        {onTrip ? (
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <div className="live-dot" style={{ marginBottom: 8 }} />
            <b style={{ fontSize: 16 }}>Trip is live</b>
            <div style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>Admin is tracking your cab in real time.</div>
            <button className="btn btn-danger" style={{ width: '100%', justifyContent: 'center' }} onClick={() => tripAction('end')}><Square size={16} /> End trip</button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <b style={{ fontSize: 16 }}>Ready to roll?</b>
            <div style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>Start the trip to begin picking up employees. Live tracking turns on automatically.</div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => tripAction('start')}><Play size={16} /> Start trip</button>
          </div>
        )}
      </div>

      {onTrip && (
        <div className="m-card">
          <div className="row">
            <div>
              <div className="m-label" style={{ marginBottom: 2 }}>Live status</div>
              <b style={{ fontSize: 18, textTransform: 'capitalize' }}>{String(data.vehicle.live_status || 'idle').replace(/_/g, ' ')}</b>
            </div>
            <div className="sp" />
            <button className="btn btn-sm btn-outline" onClick={notifyPassengers} disabled={sending}><BellRing size={14} /> {sending ? 'Sending…' : 'Notify passengers'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 12 }}>
            {LIVE.map((s) => (
              <button key={s.key} onClick={() => setStatus(s.key)}
                className={`btn btn-sm ${data.vehicle.live_status === s.key ? 'btn-primary' : 'btn-outline'}`}
                style={{ padding: '7px 2px', fontSize: 11 }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {onTrip && data.run && data.run.phase !== 'done' && (() => {
        const nextSched = safeSchedules.find((s) => s.id === data.run.scheduleId);
        return (
          <div className="m-card" style={{ border: '1.5px solid var(--primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Navigation size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="m-label" style={{ marginBottom: 2 }}>Next stop · {data.run.phase === 'drop' ? 'drop off' : 'pick up'}</div>
                <b style={{ fontSize: 16 }}>{nextSched?.name || data.run.employee_name || `Rider #${data.run.employee_id || ''}`}</b>
                {nextSched && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{nextSched.pickup_time}{data.run.phase === 'drop' ? ` · drop ${nextSched.drop_time || ''}` : ''}</div>}
              </div>
              <Badge color={data.run.phase === 'drop' ? 'green' : 'blue'}>{data.run.phase}</Badge>
            </div>
          </div>
        );
      })()}

      <div className="m-card">
        <div className="row">
          <div>
            <div className="m-label" style={{ marginBottom: 2 }}>{schoolMode ? 'Student pickup order' : 'Passenger pickup order'}</div>
            <b style={{ fontSize: 18 }}>{sequenceLen} {schoolMode ? 'students' : 'employees'}</b>
          </div>
          <div className="sp" />
          <Link to="/driver/chat" className="btn btn-sm btn-outline"><MessageCircle size={14} /> Chat admin</Link>
          <Link to="/driver/route" className="btn btn-sm btn-outline">See map <ChevronRight size={14} /></Link>
        </div>
        {safeSchedules.map((s) => {
          const c = (Array.isArray(s.checkins) ? s.checkins : []).find((x) => x.type === 'checkin' && (x.confirmed || x.method === 'swipe' || x.method === null || x.method === undefined));
          const pendingOtp = (Array.isArray(s.checkins) ? s.checkins : []).find((x) => x.type === 'checkin' && x.method === 'otp' && !x.confirmed);
          if (isStudent(s)) {
            const st = studentStatus(s);
            const sp = s.student_profile;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.sequence}</div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 14 }}>{s.name}</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {sp?.class_grade ? `${sp.class_grade}${sp.section ? '−' + sp.section : ''}` : ''} {sp?.class_grade ? '· ' : ''}{s.pickup_time}
                  </div>
                </div>
                <Badge color={st.c}>{st.t}</Badge>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!s.absent && !s.boarded_at && !s.dropped_at && (
                    <>
                      <button className="btn btn-sm btn-outline" style={{ padding: '4px 8px' }} onClick={() => studentAction(s.id, 'absent')}>Absent</button>
                      <button className="btn btn-sm btn-primary" style={{ padding: '4px 10px' }} onClick={() => studentAction(s.id, 'boarded')}>Boarded</button>
                    </>
                  )}
                  {(s.boarded_at || (s.dropped_at && s.drop_otp)) && !s.drop_confirmed && (
                    <button className="btn btn-sm btn-outline" style={{ padding: '4px 10px' }} onClick={() => studentAction(s.id, 'dropped')}>Dropped</button>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={s.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.sequence}</div>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 14 }}>{s.name}</b>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.pickup_time} · {s.phone}</div>
                </div>
                {c ? <Badge color="green">Checked in {c.time?.slice(11, 16)}</Badge> : pendingOtp ? <Badge color="amber">Ask OTP</Badge> : <Badge color="slate">Not yet</Badge>}
              </div>
              {!c && pendingOtp && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0 10px 38px', borderBottom: '1px solid #f1f5f9' }}>
                  <input
                    value={otpMap[s.id] || ''}
                    onChange={(e) => setOtpMap({ ...otpMap, [s.id]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    inputMode="numeric" autoComplete="one-time-code"
                    placeholder="OTP"
                    style={{ width: 76, textAlign: 'center', letterSpacing: 4, fontSize: 16, padding: '7px 8px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--font-mono)' }}
                  />
                  <button className="btn btn-sm btn-primary" style={{ padding: '7px 12px' }} onClick={() => confirmOtp(s)}>Confirm check-in</button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ask {s.name} to read out their OTP.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
