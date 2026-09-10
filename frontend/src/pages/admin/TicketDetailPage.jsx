import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Badge, useToast } from '../../components/ui';
import { ArrowLeft, Send, ChevronUp, AlertTriangle, CheckCircle, XCircle, Lock, MessageSquare, Clock, User, RefreshCcw, Trash2 } from 'lucide-react';

const STATUS_COLORS = { open: 'amber', in_progress: 'indigo', escalated: 'red', resolved: 'green', closed: 'slate' };
const PRIORITY_COLORS = { low: 'slate', medium: 'amber', high: 'red', urgent: 'red' };

export default function TicketDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => { api.get(`/api/tickets/${id}`).then(setTicket).catch(() => {}); };
  useEffect(() => { load(); }, [id]);

  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/tickets/${id}/comment`, { message: comment, is_internal: isInternal });
      setComment(''); setIsInternal(false); load();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const updateTicket = async (patch) => {
    try { await api.put(`/api/tickets/${id}`, patch); toast('Updated'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const escalate = async () => {
    try { await api.post(`/api/tickets/${id}/escalate`); toast('Ticket escalated'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const resolve = async () => {
    try { await api.post(`/api/tickets/${id}/resolve`); toast('Ticket resolved'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const close = async () => {
    try { await api.post(`/api/tickets/${id}/close`); toast('Ticket closed'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const reopen = async () => {
    try { await api.post(`/api/tickets/${id}/reopen`); toast('Ticket reopened'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  const del = async () => {
    if (!confirm(`Delete ticket #${id} permanently? Comments and history are removed too. This cannot be undone.`)) return;
    try { await api.del(`/api/tickets/${id}`); toast('Ticket deleted'); nav('/admin/tickets'); } catch (e) { toast(e.message, 'err'); }
  };

  if (!ticket) return <div style={{ padding: 24 }}><div className="empty">Loading ticket...</div></div>;

  const isAdmin = user?.role === 'admin';
  const isOwner = user?.isOwner;
  const isOpen = ['open', 'in_progress', 'escalated'].includes(ticket.status);

  return (
    <div style={{ padding: 24, maxWidth: 740 }}>
      <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13, marginBottom: 12, padding: 0 }}>
        <ArrowLeft size={15} /> Back to tickets
      </button>

      <div style={{ background: '#fff', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--muted)' }}>#{ticket.id}</span>
          <Badge color={STATUS_COLORS[ticket.status]}>{ticket.status.replace(/_/g, ' ')}</Badge>
          <Badge color={PRIORITY_COLORS[ticket.priority]}>{ticket.priority}</Badge>
          <Badge color="violet">{ticket.escalation_level}</Badge>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
            {ticket.created_at ? new Date(ticket.created_at).toLocaleString('en-IN') : '—'}
          </span>
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{ticket.subject}</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          {ticket.category?.replace(/-/g, ' ')} · by {ticket.creator_name} ({ticket.creator_emp_id || ticket.creator_role})
          {ticket.assigned_name && <> · Assigned to {ticket.assigned_name}</>}
        </div>
        {ticket.description && (
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--slate)', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {ticket.description}
          </div>
        )}

        {isAdmin && isOpen && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
            <select value={ticket.status} onChange={(e) => updateTicket({ status: e.target.value })}
              style={{ padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
              {['open', 'in_progress', 'escalated', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={ticket.priority} onChange={(e) => updateTicket({ priority: e.target.value })}
              style={{ padding: '6px 10px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
              {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {ticket.escalation_level !== 'owner' && (
              <button className="btn btn-sm btn-outline" onClick={escalate} style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
                <ChevronUp size={14} /> Escalate to {ticket.escalation_level === 'employee' ? 'Admin' : 'Owner'}
              </button>
            )}
            <button className="btn btn-sm btn-green" onClick={resolve}><CheckCircle size={14} /> Resolve</button>
            <button className="btn btn-sm btn-ghost" onClick={close}><XCircle size={14} /> Close</button>
          </div>
        )}
        {['resolved', 'closed'].includes(ticket.status) && (
          <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm btn-outline" onClick={reopen}><RefreshCcw size={14} /> Re-open ticket</button>
            {(ticket.status === 'resolved') && isAdmin && (
              <button className="btn btn-sm btn-ghost" onClick={close}><Lock size={14} /> Close ticket</button>
            )}
            {isAdmin && (
              <button className="btn btn-sm btn-ghost" onClick={del} style={{ marginLeft: 'auto', color: '#ef4444' }}><Trash2 size={14} /> Delete ticket</button>
            )}
          </div>
        )}
        {!['resolved', 'closed'].includes(ticket.status) && isAdmin && (
          <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-ghost" onClick={del} style={{ color: '#ef4444' }}><Trash2 size={14} /> Delete ticket</button>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><MessageSquare size={15} /> Conversation</h4>
        {(ticket.comments || []).length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>No comments yet. Start the conversation below.</div>
        )}
        {(ticket.comments || []).map((c) => {
          const isMe = c.user_id === user?.id;
          return (
            <div key={c.id} style={{ marginBottom: 12, display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', background: isMe ? 'var(--primary)' : '#f1f5f9', color: isMe ? '#fff' : 'inherit', borderRadius: 12, padding: '10px 14px' }}>
                {!isMe && <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3, opacity: 0.7 }}>{c.user_name} {c.user_role === 'admin' ? '(Admin)' : ''}</div>}
                <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.message}</div>
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6, textAlign: 'right' }}>
                  {new Date(c.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  {c.is_internal ? ' · Internal' : ''}
                </div>
              </div>
            </div>
          );
        })}

        {isOpen && (
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, marginTop: 8 }}>
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Type your reply..." style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              {isAdmin && (
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} /> Internal note (not visible to employee)
                </label>
              )}
              <button className="btn btn-primary btn-sm" onClick={addComment} disabled={busy || !comment.trim()}>
                <Send size={14} /> Send
              </button>
            </div>
          </div>
        )}
      </div>

      {(ticket.history || []).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, padding: 20 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={15} /> Timeline</h4>
          {ticket.history.map((h) => (
            <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: h.action === 'escalated' ? '#ef4444' : h.action === 'resolved' ? '#10b981' : '#6366f1', marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{h.user_name || 'System'}</span>
                <span style={{ color: 'var(--muted)' }}> {h.action.replace(/_/g, ' ')}</span>
                {h.old_value && h.new_value && <span style={{ color: 'var(--muted)' }}> from <b>{h.old_value}</b> to <b>{h.new_value}</b></span>}
                {h.action === 'commented' && h.new_value && <span style={{ color: 'var(--muted)' }}> "{h.new_value}"</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {new Date(h.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
