import React, { useState, useRef, useEffect } from 'react';
import { api, getToken } from '../../api';
import { useToast } from '../../components/ui';
import { MessageSquare, Send, Brain } from 'lucide-react';

const formatAnswer = (a) => {
  if (a == null) return "I couldn't process that just now — please try again.";
  if (typeof a === 'string' && a.trim()) return a;
  if (typeof a === 'object' && typeof a.what === 'string' && a.what.trim()) return a.what;
  return "I couldn't process that just now — please try again.";
};

export default function AITransportManager() {
  const toast = useToast();
  const [messages, setMessages] = useState([
    { role: 'system', text: 'Ask me anything about your transport operations — today\u2019s trips and status, attendance and punctuality, no-shows, delays, active drivers and vehicles, available fleet, safety events, costs, employee profiles, or a monthly summary.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const downloadFile = async (dl) => {
    try {
      const res = await fetch(dl.url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = dl.filename || 'GetInRoute_export.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast(e.message || 'Download failed', 'err'); }
  };

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const r = await api.post('/api/v3/ai/transport-manager', { question: q });
      const answer = formatAnswer(r && r.answer);
      setMessages((prev) => [...prev, { role: 'assistant', text: answer, download: (r && r.download) || null }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', text: "Sorry, I couldn't reach the intelligence service. Please try again in a moment." }]);
      toast(e.message, 'err');
    }
    setLoading(false);
  };

  return (
    <div className="page ai-chat" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <div className="page-title"><Brain size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />AI Transport Manager</div>
          <div className="page-sub">Ask questions in plain language — answers come from your verified operational data.</div>
        </div>
      </div>

      <div ref={scrollRef} className="ai-messages">
        {messages.map((m, i) => (
          <div key={i} className={`ai-row ${m.role}`}>
            <div className="ai-bubble">
              {m.text}
              {m.download && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => downloadFile(m.download)}>
                    ⬇ {m.download.filename}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="ai-row assistant"><div className="ai-bubble ai-thinking">Thinking...</div></div>
        )}
      </div>

      <div className="ai-input-wrap">
        <MessageSquare size={16} className="ai-input-ico" />
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask about trips, attendance, drivers, vehicles, safety, costs..." className="ai-input" />
        <button className="btn btn-primary btn-icon ai-send" disabled={loading || !input.trim()} onClick={send} aria-label="Send"><Send size={16} /></button>
      </div>
    </div>
  );
}