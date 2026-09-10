import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, useInterval, Modal } from '../../components/ui';
import { LiveMap } from '../../components/ui';
import { Bus, ShieldCheck, CheckCircle2, Lock, Users } from 'lucide-react';

export default function ParentHome() {
  const toast = useToast();
  const [children, setChildren] = useState([]);
  const [busy, setBusy] = useState(null);
  const [confirmChild, setConfirmChild] = useState(null);
  const [otp, setOtp] = useState('');

  const load = () => api.get('/api/parent/children').then((r) => setChildren(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); }, []);
  useInterval(load, 10000);

  const doConfirm = async () => {
    setBusy(confirmChild.student.id);
    try {
      const body = confirmChild.schedule.times?.needs_drop_confirm ? { otp } : {};
      const r = await api.post(`/api/parent/child/${confirmChild.student.id}/drop-confirm`, body);
      toast(r.message);
      setConfirmChild(null); setOtp(''); load();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(null);
  };

  const active = children.filter((c) => c.schedule && c.schedule.vehicle);
  const mapCenter = active[0]?.schedule?.vehicle
    ? { lat: active[0].schedule.vehicle.lat, lng: active[0].schedule.vehicle.lng }
    : (children[0]?.schedule?.my_stop?.lat ? { lat: children[0].schedule.my_stop.lat, lng: children[0].schedule.my_stop.lng } : null);

  return (
    <div>
      {children.length === 0 && (
        <div className="m-card">
          <div className="empty">
            <Users size={22} />
            <p>No children linked yet.<br />Use your child's <b>Parent link code</b> on the Account tab to start tracking.</p>
          </div>
        </div>
      )}

      {children.map((c) => {
        const { student, schedule } = c;
        const times = schedule?.times || {};
        const veh = schedule?.vehicle;
        let status = { badge: 'slate', label: 'No trip today', icon: null };
        if (schedule?.route_name) {
          if (times.absent) status = { badge: 'red', label: 'Absent', icon: null };
          else if (times.boarded_at && !times.dropped_at) status = { badge: 'green', label: 'On the bus', icon: <Bus size={14} /> };
          else if (times.dropped_at && times.drop_confirmed) status = { badge: 'green', label: 'Reached home ✔', icon: <CheckCircle2 size={14} /> };
          else if (times.dropped_at) status = { badge: 'amber', label: 'Dropped · confirm drop', icon: <Lock size={14} /> };
          else status = { badge: 'blue', label: 'Scheduled · bus on the way', icon: <Bus size={14} /> };
        }
        return (
          <div className="m-card" key={student.id}>
            <div className="row">
              <div>
                <div className="m-label">My child</div>
                <h2>{student.name}</h2>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {student.class_grade ? `${student.class_grade}${student.section ? ' − ' + student.section : ''}` : ''}
                  {c.relation ? ` · ${c.relation}` : ''}
                </div>
              </div>
              <div className="sp" />
              <span className={`badge badge-${status.badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{status.icon} {status.label}</span>
            </div>

            {schedule && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
                <span className="chip"><Bus size={13} /> {schedule.route_name} / bus {veh ? veh.name : '—'}</span>
                {schedule.pickup_time && <span className="chip">Pickup {schedule.pickup_time}</span>}
                {veh && veh.driver_name && (
                  <span className="chip">
                    <ShieldCheck size={13} color={veh.driver_verified ? '#10b981' : '#f59e0b'} />
                    {veh.driver_name} {veh.driver_verified ? '· Verified driver' : '· Driver'}
                  </span>
                )}
              </div>
            )}

            {times.boarded_at && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Boarded at {String(times.boarded_at).slice(11, 16)}</div>}
            {times.dropped_at && !times.drop_confirmed && !times.absent && (
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => { setConfirmChild(c); setOtp(''); }}>
                <Lock size={16} /> Confirm my child is home
              </button>
            )}

            {veh && (veh.lat || veh.lng) && (
              <div style={{ marginTop: 12 }}>
                <LiveMap center={mapCenter || [12.9716, 77.5946]} vehicles={[{ ...veh, id: `v${veh.id}`, lat: veh.lat, lng: veh.lng, type: 'school' }]} stops={schedule.route_stops?.map((s, i) => ({ ...s, sequence: i }))} height="240px" />
              </div>
            )}
          </div>
        );
      })}

      <Modal open={!!confirmChild} onClose={() => setConfirmChild(null)} title={`Confirm drop — ${confirmChild?.student?.name || ''}`}>
        {confirmChild?.schedule?.times?.needs_drop_confirm ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--slate)' }}>
              The driver marked the bus as arrived. Your school requires a One-Time Password to confirm. <b>Check your SMS</b> for the drop-off OTP.
            </p>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Drop-off OTP</label>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="OTP from SMS" style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
            </div>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--slate)' }}>Confirm that {confirmChild?.student?.name} reached home safely. This is shared with the school and driver.</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setConfirmChild(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doConfirm} disabled={busy === confirmChild?.student?.id}>
            <CheckCircle2 size={16} /> {busy === confirmChild?.student?.id ? 'Confirming…' : 'Confirm drop'}
          </button>
        </div>
      </Modal>
    </div>
  );
}