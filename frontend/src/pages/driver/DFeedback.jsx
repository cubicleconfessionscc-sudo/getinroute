import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast, Badge } from '../../components/ui';
import { Star } from 'lucide-react';

export default function DFeedback() {
  const toast = useToast();
  const [completed, setCompleted] = useState([]);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [given, setGiven] = useState([]);

  const load = () => {
    api.get('/api/driver/today').then((d) => {
      const done = (d?.schedules || []).filter((s) => s.status === 'completed');
      setCompleted(done);
    }).catch(() => {});
    api.get('/api/driver/feedback').then((f) => setGiven(f)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!scheduleId || !rating) return toast('Select a trip and a rating', 'err');
    try {
      await api.post('/api/driver/feedback', { schedule_id: Number(scheduleId), rating, message });
      toast('Feedback submitted'); setRating(0); setMessage('');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div>
      <div className="m-card">
        <div className="m-label">Trip feedback</div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Completed trip</label>
          <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            {completed.length === 0 && <option value="">No completed trips yet</option>}
            {completed.map((s) => <option key={s.id} value={s.id}>{s.date} · {s.name} ({s.pickup_time})</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Rating</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} style={{ background: 'none', border: 'none' }}>
                <Star size={26} fill={n <= rating ? '#f59e0b' : '#e2e8f0'} color={n <= rating ? '#f59e0b' : '#cbd5e1'} />
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Comments</label>
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How was the passenger experience?" />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit}>Submit feedback</button>
      </div>

      {given.length > 0 && (
        <div className="m-card">
          <div className="m-label">Submitted feedback</div>
          {given.map((f) => (
            <div key={f.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ color: '#f59e0b' }}>{'★'.repeat(f.rating)}</span> <b>{f.employee_name}</b>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{f.message} · {f.created_at}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
