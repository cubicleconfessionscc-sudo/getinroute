import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/ui';
import { useSocket, useSocketEvent } from '../../socket';
import { useAuth } from '../../auth';
import { Send, Search, X, Loader2 } from 'lucide-react';

const ROLE_ICON = { driver: '🚌', employee: '👤' };

export default function AdminChat() {
  const toast = useToast();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(false);
  const bottomRef = useRef(null);
  const searchTimer = useRef(null);
  const searchRef = useRef('');
  const tabRef = useRef('all');

  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const loadConversations = (query) => {
    const q = query !== undefined ? query : searchRef.current;
    setLoadingConvs(true);
    const params = {};
    if (q && q.trim()) params.q = q.trim();
    if (tabRef.current !== 'all') params.role = tabRef.current;
    return api.get('/api/chat/conversations', params)
      .then((rows) => setConversations(Array.isArray(rows) ? rows : []))
      .catch(() => setConversations([]))
      .finally(() => setLoadingConvs(false));
  };

  useEffect(() => { loadConversations(search); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return setMessages([]);
    api.get(`/api/chat/with/${active.id}`).then(setMessages).catch(() => {});
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const onSearchChange = (v) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadConversations(v), 350);
  };
  const clearSearch = () => {
    setSearch('');
    if (searchTimer.current) clearTimeout(searchTimer.current);
    loadConversations('');
  };

  useSocketEvent('chat:message', (msg) => {
    if (active && (msg.sender_id === active.id || msg.receiver_id === active.id)) {
      setMessages((m) => [...m, msg]);
      if (msg.sender_id === active.id) api.post(`/api/chat/read/${active.id}`).catch(() => {});
    } else if (msg.receiver_id === user?.id) {
      toast(`💬 New message from ${conversations.find((c) => c.id === msg.sender_id)?.name || 'someone'}`, 'info');
      loadConversations();
    }
  });

  const send = async () => {
    const body = text.trim();
    if (!body || !active) return;
    setText('');
    if (socket) socket.emit('chat:send', { receiver_id: active.id, message: body });
    else await api.post('/api/chat/send', { receiver_id: active.id, message: body }).catch(() => {});
    setMessages((m) => [...m, { id: 'tmp-' + Date.now(), sender_id: user.id, receiver_id: active.id, message: body, created_at: new Date().toLocaleString() }]);
    loadConversations();
  };

  const openConv = async (c) => {
    setActive(c);
    await api.post(`/api/chat/read/${c.id}`).catch(() => {});
    loadConversations();
  };

  const searching = search.trim().length > 0;
  const emptyText = searching ? 'No matching conversations found.' : 'No conversations yet.';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">Messages</div>
          <div className="page-sub">Realtime chat with drivers and employees.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['all', 'All'], ['driver', 'Drivers'], ['employee', 'Employees']].map(([k, l]) => (
            <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setTab(k); setActive(null); }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '320px 1fr', minHeight: 'calc(100vh - 220px)' }}>
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 220px)' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 20, top: 21, color: 'var(--muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 34, paddingRight: search ? 32 : 12 }}
              placeholder="Search by name, employee ID, driver ID or phone number"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search conversations"
            />
            {search ? (
              <button type="button" onClick={clearSearch} title="Clear search"
                style={{ position: 'absolute', right: 18, top: 18, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
                <X size={16} />
              </button>
            ) : null}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loadingConvs && <div className="empty" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="spin" /> Searching…</div>}
            {!loadingConvs && conversations.length === 0 && <div className="empty" style={{ padding: 20 }}>{emptyText}</div>}
            {conversations.map((c) => (
              <button key={c.id} onClick={() => openConv(c)}
                style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: active?.id === c.id ? 'var(--grad-soft)' : 'transparent', cursor: 'pointer' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{ROLE_ICON[c.role] || '👤'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <b style={{ fontSize: 13 }}>{c.name}</b>
                    {c.unread > 0 && <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>{c.unread}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.emp_id} · {c.role}</div>
                  {c.last_message
                    ? <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.last_message}</div>
                    : <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No messages yet — tap to start</div>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 220px)' }}>
          {!active ? (
            <div className="empty" style={{ flex: 1 }}>Select a conversation to start chatting.</div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--grad)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{ROLE_ICON[active.role]}</div>
                <div><b style={{ fontSize: 14 }}>{active.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{active.emp_id} · {active.role}{active.phone ? ` · ${active.phone}` : ''}</div></div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gap: 8, alignContent: 'start' }}>
                {messages.length === 0 && <div className="empty">Say hi to start the conversation.</div>}
                {messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '75%', padding: '8px 12px', borderRadius: 14, fontSize: 13, background: mine ? 'var(--primary)' : 'var(--surface-2)', color: mine ? '#fff' : 'inherit', borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4 }}>
                        {m.message}
                        <div style={{ fontSize: 10, opacity: .7, marginTop: 2 }}>{m.created_at?.slice(11, 16) || m.created_at?.slice(12, 17) || m.created_at}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <div style={{ padding: 12, borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder="Type a message…" value={text}
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                <button className="btn btn-primary" onClick={send} disabled={!text.trim()}><Send size={16} /> Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
