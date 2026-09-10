import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/ui';
import { Send, AlertTriangle } from 'lucide-react';

const CATEGORIES = [
  { value: 'cab-booking', label: 'Cab Booking Issue' },
  { value: 'route-issue', label: 'Route Issue' },
  { value: 'driver-behavior', label: 'Driver Behavior' },
  { value: 'safety-concern', label: 'Safety Concern' },
  { value: 'billing', label: 'Billing' },
  { value: 'app-issue', label: 'App / Web Issue' },
  { value: 'schedule-change', label: 'Schedule Change Request' },
  { value: 'general', label: 'General' }
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: '#64748b' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#ef4444' },
  { value: 'urgent', label: 'Urgent', color: '#dc2626' }
];

export default function TicketCreatePage() {
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState({ subject: '', description: '', category: 'general', priority: 'medium' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.subject.trim()) return toast('Subject is required', 'err');
    setBusy(true);
    try {
      const r = await api.post('/api/tickets', form);
      toast(`Ticket #${r.id} created`);
      const base = user?.role === 'admin' ? '/admin' : '/app';
      nav(`${base}/tickets/${r.id}`);
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 4px' }}>Raise a Support Ticket</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>Describe your issue. The transport team will respond promptly.</p>

      <div style={{ background: '#fff', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 20 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Category</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Priority</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {PRIORITIES.map((p) => (
              <button key={p.value} onClick={() => setForm({ ...form, priority: p.value })}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${form.priority === p.value ? p.color : 'var(--line)'}`, background: form.priority === p.value ? p.color + '15' : '#fff', color: form.priority === p.value ? p.color : 'var(--slate)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {p.value === 'urgent' && <AlertTriangle size={13} style={{ marginRight: 3, verticalAlign: -2 }} />}
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Subject</label>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Brief description of your issue" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13 }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Details</label>
          <textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe what happened — date, time, vehicle, route, etc. The more detail, the faster we can help." style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.subject.trim()}>
            <Send size={15} /> {busy ? 'Submitting...' : 'Submit ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
