import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[GetInRoute] Render crash:', error?.stack || error?.message || error);
    if (info?.componentStack) console.error('[GetInRoute] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const msg = err?.message || 'Unknown error';
      const stackLines = (err?.stack || '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 8)
        .join('\n');
      const isTopLevel = !this.props.onError;
      return (
        <div style={{ minHeight: isTopLevel ? '100vh' : 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTopLevel ? '#f1f5f9' : '#fff', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 480, textAlign: 'center', boxShadow: '0 10px 30px -12px rgba(0,0,0,.18)', width: '100%' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
              A rendering error occurred on this page.
            </p>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontFamily: 'monospace', textAlign: 'left', wordBreak: 'break-word', maxHeight: 80, overflow: 'auto' }}>
              {msg}
            </div>
            {stackLines && (
              <details style={{ textAlign: 'left', marginBottom: 16 }}>
                <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>Stack trace (tap to copy full trace)</summary>
                <pre onClick={() => navigator.clipboard?.writeText(err?.stack || '')} title="Click to copy full stack" style={{ fontSize: 11, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 6 }}>{stackLines}</pre>
              </details>
            )}
            <button onClick={() => this.setState({ hasError: false, error: null })} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Try Again
            </button>
            <button onClick={() => window.location.reload()} style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginLeft: 8 }}>
              Refresh Page
            </button>
            {isTopLevel && (
              <button onClick={() => { localStorage.removeItem('getinroute_token'); window.location.href = '/login'; }} style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginLeft: 8 }}>
                Sign in again
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
