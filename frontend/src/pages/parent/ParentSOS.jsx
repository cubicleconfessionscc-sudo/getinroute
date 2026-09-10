import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { ShieldAlert, MapPin, Send } from 'lucide-react';

export default function ParentSOS() {
  const toast = useToast();
  const [children, setChildren] = useState([]);
  const [student_id, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [loc, setLoc] = useState(null);
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => { api.get('/api/parent/children').then((r) => setChildren(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const findLoc = () => {
    if (!navigator.geolocation) { toast('Location not available on this device', 'err'); return; }
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setFinding(false); },
      () => { toast('Could not get location', 'err'); setFinding(false); },
      { timeout: 7000 }
    );
  };

  const send = async () => {
    setSending(true);
    try {
      await api.post('/api/parent/sos', { student_id: student_id ? Number(student_id) : null, lat: loc?.lat ?? null, lng: loc?.lng ?? null, message: message || null });
      toast('SOS sent. The school has been alerted and notified by SMS.');
      setMessage(''); setStudentId(''); setLoc(null);
    } catch (e) { toast(e.message, 'err'); }
    setSending(false);
  };

  return (
    <div>
      <div className="m-card" style={{ background: 'linear-gradient(135deg,#fee2e2,#fff)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <ShieldAlert size={24} color="#ef4444" />
          <div>
            <b style={{ fontSize: 16 }}>Raise an SOS</b>
            <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 2 }}>
              The school admin and, if an SMS gateway is configured, their phones are alerted immediately.
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Regarding child</label>
          <select value={student_id} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">— General / any child —</option>
            {children.map((c) => <option key={c.student.id} value={c.student.id}>{c.student.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>Message (optional)</label>
          <textarea rows="3" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Bus is late at the stop, please check" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button className="btn btn-sm btn-outline" onClick={findLoc} disabled={finding}>
            <MapPin size={14} /> {finding ? 'Finding…' : loc ? 'Location attached ✔' : 'Attach my location'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'helps the school reach you'}
          </span>
        </div>
        <button className="btn btn-danger" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={send} disabled={sending}>
          <Send size={16} /> {sending ? 'Sending…' : 'Send SOS'}
        </button>
      </div>

      {children.length === 0 && (
        <div className="m-card">
          <div className="empty">Link a child first (Account tab) so the school knows who the SOS is about.</div>
          <Link to="/parent/account" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>Go to Account</Link>
        </div>
      )}
    </div>
  );
}