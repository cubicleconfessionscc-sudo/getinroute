import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast, useInterval } from '../../components/ui';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dirLabel(d) { return d === 'toHome' ? 'Logout' : 'Login'; }
function statusLabel(s) {
  return { assigned: 'Vehicle allocated', started: 'Driver started', in_progress: 'On the way', completed: 'Completed', confirmed: 'Scheduled', requested: 'Awaiting approval', cancelled: 'Cancelled' }[s] || 'Vehicle pending';
}
function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${String(hh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

export default function ESchedule() {
  const toast = useToast();
  const [schedules, setSchedules] = useState([]);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState(() => ymd(new Date()));

  const load = () => {
    api.get('/api/schedules/mine').then((r) => setSchedules(Array.isArray(r) ? r : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useInterval(load, 15000);

  const doCancel = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this trip?')) return;
    try { await api.del(`/api/schedules/${id}`); toast('Booking cancelled'); load(); }
    catch (e) { toast(e.response?.data?.message || 'Cancel failed', 'err'); }
  };

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = ymd(new Date());

  const byDate = {};
  (schedules || []).forEach((s) => { (byDate[s.date] = byDate[s.date] || []).push(s); });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const selectedTrips = byDate[selected] || [];

  const changeMonth = (delta) => {
    const c = new Date(year, month + delta, 1);
    setCursor(c);
  };

  return (
    <div className="eh-root">
      <div className="eh-hero">
        <div>
          <h2 className="eh-greet">My Schedule</h2>
          <div className="eh-sub">See what you've booked and manage each trip.</div>
        </div>
        <Link to="/app#book" className="btn btn-primary btn-sm">+ Book a Ride</Link>
      </div>

      <div className="es-grid">
        <div className="es-cal">
          <div className="es-cal-head">
            <button className="es-nav" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
            <div className="es-cal-title"><Calendar size={16} /> {cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
            <button className="es-nav" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
          <div className="es-weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="es-wd">{w}</div>)}
          </div>
          <div className="es-days">
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="es-day empty" />;
              const ds = ymd(d);
              const has = byDate[ds]?.length;
              const isToday = ds === today;
              const isSel = ds === selected;
              return (
                <button key={i} className={`es-day ${isSel ? 'sel' : ''} ${isToday ? 'today' : ''} ${has ? 'has' : ''}`} onClick={() => setSelected(ds)}>
                  <span>{d.getDate()}</span>
                  {has ? <span className="es-dotmark" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="es-list">
          <div className="es-list-title">{new Date(selected + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {selectedTrips.length === 0 ? (
            <div className="eh-empty" style={{ padding: 24 }}>
              <div style={{ fontSize: 32 }}>🗓️</div>
              <b>No trips booked</b>
              <div className="eh-empty-sub">Nothing scheduled for this day.</div>
              <Link to="/app#book" className="btn btn-primary" style={{ marginTop: 14 }}>+ Book a Ride</Link>
            </div>
          ) : (
            selectedTrips.map((s) => (
              <div key={s.id} className="eh-trip" style={{ marginBottom: 12 }}>
                <div className="eh-trip-head">
                  <span className="eh-pill">{dirLabel(s.direction)}</span>
                  <span className="eh-trip-time">{fmtTime(s.pickup_time || s.login_time || s.drop_time || s.logout_time)}</span>
                </div>
                <div className={`eh-status ${['confirmed', 'in_progress', 'assigned', 'started'].includes(s.status) ? 'ok' : 'warn'}`}><span className="eh-dot" /> {statusLabel(s.status)}</div>
                <div className="eh-route">
                  <div className="eh-route-row"><span className="eh-rdot primary" /> {s.pickup_point || 'Pickup point'}</div>
                  <div className="eh-route-row"><span className="eh-rdot violet" /> {s.direction === 'toHome' ? 'Home' : 'Office'}</div>
                </div>
                <div className="eh-trip-actions">
                  <Link to="/app/track" className="btn btn-sm btn-outline">View details</Link>
                  {['confirmed', 'requested', 'in_progress'].includes(s.status) && (
                    <button className="btn btn-sm btn-outline" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => doCancel(s.id)}>Cancel</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
