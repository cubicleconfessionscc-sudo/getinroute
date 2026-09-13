import React, { useState, useRef, useEffect } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { MessageSquare, Send, Brain } from 'lucide-react';

const formatAnswer = (a) => {
  if (a == null) return 'No answer returned.';
  if (typeof a === 'string') return a;
  if (typeof a === 'object' && a.what) {
    const lines = [a.what];
    if (a.why) lines.push('Why — ' + a.why);
    if (a.data && typeof a.data === 'object' && Object.keys(a.data).length) {
      lines.push('Data — ' + JSON.stringify(a.data, null, 2));
    }
    if (a.action) lines.push('Action — ' + a.action);
    return lines.join('\n\n');
  }
  return JSON.stringify(a, null, 2);
};

export default function AITransportManager() {
  const toast = useToast();
  const [messages, setMessages] = useState([
    { role: 'system', text: 'Ask me anything about your transport operations. I can analyze routes, vehicles, schedules, costs, and more.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const r = await api.post('/api/v3/ai/transport-manager', { question: q });
      const answer = (r && r.answer) || (r && r.intent ? { what: 'Intent: ' + r.intent, data: r.recommendation || r.data || null } : null);
      setMessages((prev) => [...prev, { role: 'assistant', text: formatAnswer(answer), intent: r && r.intent, confidence: r && r.confidence }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Error: ' + e.message }]);
      toast(e.message, 'err');
    }
    setLoading(false);
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div className="page-head">
        <div>
          <div className="page-title"><Brain size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />AI Transport Manager</div>
          <div className="page-sub">Natural language interface for transport operations intelligence.</div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16, background: 'var(--bg)', borderRadius: 8, marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{
              maxWidth: '75%', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: m.role === 'user' ? '#4f46e5' : m.role === 'system' ? '#f1f5f9' : '#fff',
              color: m.role === 'user' ? '#fff' : m.role === 'system' ? '#64748b' : '#1e293b',
              border: m.role === 'assistant' ? '1px solid var(--line)' : 'none'
            }}>
              {m.role === 'assistant' && m.intent && (
                <div style={{ fontSize: 11, color: 'var(--primary)', marginBottom: 4, fontWeight: 600 }}>Intent: {m.intent}{m.confidence != null ? ' (' + m.confidence + '%)' : ''}</div>
              )}
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff', border: '1px solid var(--line)', fontSize: 13, color: 'var(--muted)' }}>
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask about routes, vehicles, costs, safety..." style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 12, fontSize: 13 }} />
        <button className="btn btn-primary" disabled={loading || !input.trim()} onClick={send}><Send size={16} /></button>
      </div>
    </div>
  );
}
