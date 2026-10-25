import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { getPosition } from '../../lib/geolocation';
import BackButton from '../../components/BackButton';
import { AlertTriangle, LifeBuoy, MessageSquare, Phone, Send } from 'lucide-react';

/* Web twin of the mobile Help screen (employee + driver).
   Support config comes from the company; messages are emailed to the
   company's support mailbox; SOS creates a real alert visible to admins. */
export default function HelpPage({ kind = 'employee' }) {
  const toast = useToast();
  const [config, setConfig] = useState({ helplinePhone: '', supportEmail: '', whatsapp: '' });
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sosBusy, setSosBusy] = useState(false);

  useEffect(() => {
    api.get('/api/support/config').then((c) => setConfig(c || {})).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return toast('Write a message first.', 'err');
    setSending(true);
    try {
      const r = await api.post('/api/support/contact', { message: message.trim() });
      toast(r?.message || 'Sent to support.');
      setMessage('');
    } catch (err) {
      toast(err.message || 'Could not send your message.', 'err');
    } finally { setSending(false); }
  };

  const raiseSos = async () => {
    if (!window.confirm('Raise an SOS? This immediately alerts your transport admins. Only use it in a genuine emergency.')) return;
    setSosBusy(true);
    try {
      const pos = await getPosition({ interactive: false }).catch(() => null);
      let tripId = null;
      try {
        if (kind === 'driver') {
          const today = await api.get('/api/driver/today').catch(() => null);
          tripId = today?.run?.scheduleId || today?.schedules?.[0]?.id || null;
        } else {
          const live = await api.get('/api/schedules/allotments/live').catch(() => []);
          const active = (Array.isArray(live) ? live : []).find((a) => a.status === 'assigned' || a.status === 'started');
          tripId = active?._id || active?.scheduleId || null;
        }
      } catch { /* no active trip is fine */ }
      const r = await api.post('/api/alerts', {
        note: `SOS raised from the web ${kind} portal`,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        tripId
      });
      if (r?.ok) toast('SOS sent. Your transport team has been alerted.');
      else toast('SOS could not be confirmed. Please call the helpline.', 'err');
    } catch (err) {
      toast(err.message || 'Could not send SOS. Please call the helpline.', 'err');
    } finally { setSosBusy(false); }
  };

  const tel = String(config.helplinePhone || '').replace(/[^+\d]/g, '');

  return (
    <div className="page" style={{ display: 'grid', gap: 14 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LifeBuoy size={22} color="var(--primary)" /> Help &amp; SOS
          </div>
          <div className="page-sub">Talk to your transport team, raise an emergency alert, or send a message.</div>
        </div>
        <BackButton to={kind === 'driver' ? '/driver' : '/app'} />
      </div>

      <section className="card" style={{ padding: 16, borderColor: 'rgba(239,68,68,.4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(239,68,68,.12)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>Emergency SOS</b>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '3px 0 10px' }}>
              Alerts every admin for your company with your name, account and (when available) your location.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-danger btn-sm" onClick={raiseSos} disabled={sosBusy}>
                {sosBusy ? 'Sending…' : 'Raise SOS'}
              </button>
              {tel ? (
                <a className="btn btn-outline btn-sm" href={`tel:${tel}`}><Phone size={14} /> Call helpline {config.helplinePhone}</a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MessageSquare size={17} color="var(--primary)" />
          <b style={{ fontSize: 15 }}>Message support</b>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          Goes to {config.supportEmail || 'your company support inbox'}. You can also <Link className="auth-link" to={kind === 'driver' ? '/driver/feedback' : '/app/feedback'}>send trip feedback</Link> or <Link className="auth-link" to={kind === 'driver' ? '/driver/notifications' : '/app/tickets'}>open a support ticket</Link>.
        </p>
        <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="How can we help?"
            style={{ width: '100%' }}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !message.trim()} style={{ justifySelf: 'start' }}>
            <Send size={15} /> {sending ? 'Sending…' : 'Send message'}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>
        <b style={{ color: 'var(--text)', display: 'block', marginBottom: 6 }}>Session &amp; account</b>
        Your web session stays signed in until you log out. If you are on a shared computer, use Logout from the menu.
        {config.whatsapp ? <> WhatsApp support: <b>{config.whatsapp}</b>.</> : null}
      </section>
    </div>
  );
}
