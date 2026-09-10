import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';
import { useSocket, useSocketEvent } from '../socket';
import { useAuth } from '../auth';
import { Send } from 'lucide-react';

export default function MobileChat() {
  const toast = useToast();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/api/chat/conversations').then((rows) => {
      setConv((Array.isArray(rows) ? rows : [])[0] || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conv) return setMessages([]);
    api.get(`/api/chat/with/${conv.id}`).then(setMessages).catch(() => {});
  }, [conv?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useSocketEvent('chat:message', (msg) => {
    if (conv && (msg.sender_id === conv.id || msg.receiver_id === conv.id)) {
      setMessages((m) => [...m, msg]);
      if (msg.sender_id === conv.id) api.post(`/api/chat/read/${conv.id}`).catch(() => {});
    }
  });

  const send = async () => {
    const body = text.trim();
    if (!body || !conv) return;
    setText('');
    if (socket) socket.emit('chat:send', { receiver_id: conv.id, message: body });
    else await api.post('/api/chat/send', { receiver_id: conv.id, message: body }).catch(() => {});
    setMessages((m) => [...m, { id: 'tmp-' + Date.now(), sender_id: user.id, receiver_id: conv.id, message: body, created_at: new Date().toLocaleString() }]);
  };

  if (!conv) return <div className="m-card"><div className="empty">No conversation available.</div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)' }}>
      <div className="m-card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: '14px 14px 0 0', marginBottom: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>OP</div>
        <div>
          <b style={{ fontSize: 14 }}>{conv.name}</b>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Operations Admin</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gap: 8, alignContent: 'start', background: '#fff', border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 14px 14px' }}>
        {messages.length === 0 && <div className="empty">Say hi to the operations team.</div>}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '78%', padding: '8px 12px', borderRadius: 14, fontSize: 13, background: mine ? 'var(--primary)' : '#f1f5f9', color: mine ? '#fff' : 'inherit', borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4 }}>
                {m.message}
                <div style={{ fontSize: 10, opacity: .7, marginTop: 2 }}>{m.created_at?.slice(11, 16) || m.created_at?.slice(12, 17) || m.created_at}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Type a message…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn btn-primary" onClick={send} disabled={!text.trim()}><Send size={16} /></button>
      </div>
    </div>
  );
}
