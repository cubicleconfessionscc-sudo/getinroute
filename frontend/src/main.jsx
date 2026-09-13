import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { SocketProvider } from './socket.jsx';
import './styles.css';

window.addEventListener('error', (e) => {
  console.group('%c[GetInRoute] Uncaught error', 'color:#ef4444;font-weight:700');
  console.error(e.error || e.message);
  if (e.filename) console.log(`Source: ${e.filename}:${e.lineno}:${e.colno}`);
  console.groupEnd();
});
window.addEventListener('unhandledrejection', (e) => {
  console.group('%c[GetInRoute] Unhandled promise rejection', 'color:#ef4444;font-weight:700');
  const r = e.reason;
  if (r instanceof Error) { console.error(r.stack || r.message); } else { console.error(r); }
  console.groupEnd();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <App />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
