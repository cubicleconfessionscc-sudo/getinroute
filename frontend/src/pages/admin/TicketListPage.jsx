import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Badge, useToast } from '../../components/ui';
import { Plus, Filter, MessageSquare, AlertTriangle, ChevronRight, Trash2 } from 'lucide-react';

const STATUS_COLORS = { open: 'amber', in_progress: 'indigo', escalated: 'red', resolved: 'green', closed: 'slate' };
const PRIORITY_COLORS = { low: 'slate', medium: 'amber', high: 'red', urgent: 'red' };

export default function TicketListPage() {
  const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const isStaff = !!(user?.isOwner || user?.role === 'admin');
  const ticketBase = isStaff ? '/admin/tickets' : '/app/tickets';
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState({ status: '', priority: '' });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.priority) params.priority = filter.priority;
    api.get('/api/tickets', params).then((data) => { setTickets(Array.isArray(data) ? data : []); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filter.status, filter.priority]);

  const del = async (e, t) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete ticket #${t.id} ("${t.subject}")? This cannot be undone.`)) return;
    try { await api.del(`/api/tickets/${t.id}`); toast('Ticket deleted'); load(); } catch (err) { toast(err.message, 'err'); }
  };

  const statusCounts = {};
  tickets.forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Support Tickets</h2>
            <Link to={`${ticketBase}/new`} className="btn btn-primary"><Plus size={15} /> New Ticket</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['', 'open', 'in_progress', 'escalated', 'resolved', 'closed'].map((s) => (
          <button key={s} className={`btn btn-sm ${filter.status === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter({ ...filter, status: s })}>
            {s ? s.replace(/_/g, ' ') : 'All'} {s && statusCounts[s] ? `(${statusCounts[s]})` : ''}
          </button>
        ))}
      </div>

      {loading ? <div className="empty">Loading tickets...</div> : tickets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎫</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No tickets yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Having an issue? Create a support ticket and we'll help you out.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {tickets.map((t) => (
            <Link key={t.id} to={`${ticketBase}/${t.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'border-color .15s' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)' }}>#{t.id}</span>
                  <Badge color={PRIORITY_COLORS[t.priority]}>{t.priority}</Badge>
                  <Badge color={STATUS_COLORS[t.status]}>{t.status.replace(/_/g, ' ')}</Badge>
                  {t.escalation_level !== 'employee' && <Badge color="violet">{t.escalation_level}</Badge>}
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{t.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t.category?.replace(/-/g, ' ')} · {t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                </div>
              </div>
              {t.comment_count > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)', fontSize: 13 }}>
                  <MessageSquare size={14} /> {t.comment_count}
                </div>
              )}
              <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
              {isStaff && (
                <button onClick={(e) => del(e, t)} title="Delete ticket" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                  <Trash2 size={15} color="#ef4444" />
                </button>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
