import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { Calendar, ArrowRight, ArrowLeft, MapPin, Building2, CheckCircle2, Loader2, Car } from 'lucide-react';

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtPretty(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

const STEPS = ['Date', 'Trip', 'Time', 'Confirm'];

export default function EBook() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [profile, setProfile] = useState(null);
  const [date, setDate] = useState(localDateStr());
  const [direction, setDirection] = useState('toOffice');
  const [slotLabel, setSlotLabel] = useState('');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get('/api/schedules/config').then((r) => setConfig(r && typeof r === 'object' ? r : null)).catch(() => {});
    api.get('/api/location/profile').then((r) => setProfile(r || null)).catch(() => {});
  }, []);

  const times = direction === 'toOffice' ? (config?.loginTimes || []) : (config?.logoutTimes || []);
  useEffect(() => {
    setSlotLabel((prev) => (times.some((t) => t.label === prev) ? prev : (times[0]?.label || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, config]);

  const selected = times.find((t) => t.label === slotLabel) || times[0] || null;
  const pickup = profile?.homeLocation?.address || profile?.pickupLocation?.address || 'No pickup address on file';
  const office = config?.officeName || 'Office';
  const addressApproved = profile?.locationStatus === 'approved';

  const nextDays = useMemo(() => {
    const out = [];
    const base = new Date();
    for (let i = 0; i < 10; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      out.push(localDateStr(d));
    }
    return out;
  }, []);

  const canBook = addressApproved && selected;

  const book = async () => {
    if (!canBook) return;
    setBusy(true);
    try {
      const r = await api.post('/api/schedules', {
        dates: [date],
        direction,
        startTime: selected?.time || null,
        slotLabel: selected?.label
      });
      if (r && Array.isArray(r.skipped) && r.skipped.length) {
        toast('You already have a booking for that day.', 'info');
      } else {
        setDone({ id: r?.id, date, direction, slotLabel: selected?.label, time: selected?.time });
        toast('Ride booked successfully.');
      }
    } catch (e) { toast(e.response?.data?.message || e.response?.data?.error || 'Booking failed', 'err'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="eh-root">
        <div className="eh-empty" style={{ textAlign: 'left', padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--green)', fontWeight: 800, fontSize: 18 }}>
            <CheckCircle2 size={22} /> Booking Confirmed
          </div>
          <div className="book-summary" style={{ marginTop: 16 }}>
            <div className="bs-row"><span>Booking ID</span><b>#{String(done.id || '—').slice(-6).toUpperCase()}</b></div>
            <div className="bs-row"><span>Date</span><b>{fmtPretty(done.date)}</b></div>
            <div className="bs-row"><span>Trip</span><b>{done.direction === 'toHome' ? 'Logout (Home)' : 'Login (Office)'}</b></div>
            <div className="bs-row"><span>Time</span><b>{fmtTime(done.time)}</b></div>
            <div className="bs-row"><span>Pickup</span><b>{pickup}</b></div>
            <div className="bs-row"><span>Office</span><b>{office}</b></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <Link to="/app/schedule" className="btn btn-primary">View My Schedule</Link>
            <button className="btn btn-outline" onClick={() => { setDone(null); setStep(0); }}>Book another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="eh-root">
      <div className="eh-hero">
        <div>
          <h2 className="eh-greet">Book a Ride</h2>
          <div className="eh-sub">Plan your next office trip in a few steps.</div>
        </div>
      </div>

      <div className="book-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`book-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
            <span className="book-step-num">{i < step ? '✓' : i + 1}</span> {s}
            {i < STEPS.length - 1 && <ArrowRight size={14} className="book-step-arrow" />}
          </div>
        ))}
      </div>

      {!addressApproved && (
        <div className="m-card" style={{ border: '1.5px solid var(--amber)' }}>
          <div className="m-label" style={{ color: 'var(--amber)' }}>Address required</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Your pickup address must be approved before you can book. <Link to="/app/address" className="eh-link">Set your address →</Link>
          </div>
        </div>
      )}

      <div className="m-card">
        {step === 0 && (
          <>
            <div className="m-label"><Calendar size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Step 1 — Select travel date</div>
            <input type="date" value={date} min={localDateStr()} onChange={(e) => setDate(e.target.value)} style={{ marginTop: 10 }} />
            <div className="book-chips">
              {nextDays.slice(0, 7).map((ds) => (
                <button key={ds} className={`book-chip ${ds === date ? 'on' : ''}`} onClick={() => setDate(ds)} type="button">
                  <span>{new Date(ds + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                  <b>{new Date(ds + 'T00:00:00').getDate()}</b>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="m-label">Step 2 — Select direction</div>
            <div className="book-dir">
              <button className={`book-dir-btn ${direction === 'toOffice' ? 'on' : ''}`} onClick={() => setDirection('toOffice')} type="button">
                <Building2 size={18} /><span>Going to Office</span>
              </button>
              <button className={`book-dir-btn ${direction === 'toHome' ? 'on' : ''}`} onClick={() => setDirection('toHome')} type="button">
                <Car size={18} /><span>Going Home</span>
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="m-label">Step 3 — Select time</div>
            {times.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>No shift timings configured. Please check with your transport admin.</div>
            ) : (
              <div className="book-slots">
                {times.map((t) => (
                  <button key={t.label} className={`book-slot ${slotLabel === t.label ? 'on' : ''}`} onClick={() => setSlotLabel(t.label)} type="button">
                    <b>{t.label}</b><span>{fmtTime(t.time)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="m-label">Step 4 — Review & confirm</div>
            <div className="book-summary" style={{ marginTop: 10 }}>
              <div className="bs-row"><span>Date</span><b>{fmtPretty(date)}</b></div>
              <div className="bs-row"><span>Trip</span><b>{direction === 'toHome' ? 'Logout (Home)' : 'Login (Office)'}</b></div>
              <div className="bs-row"><span>Time</span><b>{fmtTime(selected?.time)}</b></div>
              <div className="bs-row"><span><MapPin size={13} style={{ verticalAlign: 'middle' }} /> Pickup</span><b>{pickup}</b></div>
              <div className="bs-row"><span><Building2 size={13} style={{ verticalAlign: 'middle' }} /> Office</span><b>{office}</b></div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={busy || !canBook} onClick={book}>
              {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null} {busy ? 'Booking…' : 'CONFIRM BOOKING'}
            </button>
          </>
        )}
      </div>

      <div className="book-nav">
        <button className="btn btn-outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} type="button"><ArrowLeft size={16} /> Back</button>
        {step < 3 && <button className="btn btn-primary" onClick={() => setStep((s) => Math.min(3, s + 1))} type="button">Next <ArrowRight size={16} /></button>}
      </div>
    </div>
  );
}
