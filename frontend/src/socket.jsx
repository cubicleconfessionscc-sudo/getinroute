import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api';
import { useAuth } from './auth';

const SocketCtx = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user || !getToken()) return;
    const socket = io('/', { transports: ['websocket', 'polling'], auth: { token: getToken() } });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    return () => { socket.disconnect(); socketRef.current = null; setConnected(false); };
  }, [user?.id]);

  return <SocketCtx.Provider value={{ socket: socketRef.current, connected }}>{children}</SocketCtx.Provider>;
}

export const useSocket = () => useContext(SocketCtx);

export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; }, [handler]);
  useEffect(() => {
    if (!socket) return;
    const fn = (...args) => ref.current(...args);
    socket.on(event, fn);
    return () => { socket.off(event, fn); };
  }, [socket, event]);
}
