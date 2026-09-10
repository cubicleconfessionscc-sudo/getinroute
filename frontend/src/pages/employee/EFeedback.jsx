import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { Star } from 'lucide-react';

const REASONS = ['Driver behavior', 'Route deviation', 'Late pickup', 'Rash driving', 'Poor vehicle condition', 'AC not working', 'Overcrowding', 'Others'];

export default function EFeedback() {
  const toast = useToast();
  const [allotments, setAllotments] = useState([]);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [allotmentId, setAllotmentId] = useState('');

  const load = () => {
    api.get('/api/schedules/allotments').then((list) => {
      const done = (list || []).filter((a) => a.status === 'completed');
      setAllotments(done);
      if (done.length && !allotmentId) setAllotmentId(String(done[0]._id));
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const toggleReason = (r) => {
    setSelectedReasons((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  };

  const submit = async () => {
    if (!allotmentId || !rating) return toast('Select a trip and a rating', 'err');
    try {
      await api.post('/api/feedback', {
        allotmentId,
        rating,
        message,
        reasons: rating <= 3 ? selectedReasons : undefined
      });
      toast('Thanks for your feedback!');
      setMessage(''); setRating(0); setSelectedReasons([]);
    } catch (e) { toast(e.response?.data?.message || e.message, 'err'); }
  };

  return (
    <div>
      <div className="m-card">
        <div className="m-label">Rate your completed trips</div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Select trip</label>
          <select value={allotmentId} onChange={(e) => setAllotmentId(e.target.value)}>
            {allotments.length === 0 && <option value="">No completed trips yet</option>}
            {allotments.map((a) => {
              const v = a.vehicle || {};
              const d = a.driver || {};
              return <option key={a._id} value={a._id}>{a.date ? new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'} · {v.vehicleNumber || '—'} · {d.name || '—'}</option>;
            })}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Rating</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} style={{ background: 'none', border: 'none', fontSize: 30, cursor: 'pointer' }}>
                <Star size={28} fill={n <= rating ? '#f59e0b' : '#e2e8f0'} color={n <= rating ? '#f59e0b' : '#cbd5e1'} />
              </button>
            ))}
            {rating > 0 && <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 8 }}>{rating <= 2 ? 'Poor' : rating === 3 ? 'Average' : rating === 4 ? 'Good' : 'Excellent'}</span>}
          </div>
        </div>
        {rating > 0 && rating <= 3 && REASONS.length > 0 && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label>What went wrong?</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => toggleReason(r)}
                  style={{
                    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    border: '1.5px solid', cursor: 'pointer',
                    borderColor: selectedReasons.includes(r) ? 'var(--primary)' : 'var(--line)',
                    background: selectedReasons.includes(r) ? 'rgba(79,70,229,.1)' : 'transparent',
                    color: selectedReasons.includes(r) ? 'var(--primary)' : 'var(--slate)'
                  }}
                >{r}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Comments</label>
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How was the ride? Punctuality, driver behaviour, cab condition…" />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit}>Submit feedback</button>
      </div>
    </div>
  );
}
