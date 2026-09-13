import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[GetInRoute] React error boundary:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 540, margin: '80px auto', padding: '0 16px' }}>
          <div className="card">
            <h1 style={{ color: '#dc2626', marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: '#6b7280', marginBottom: 12 }}>
              The app hit an unexpected error. Try reloading or starting a fresh session.
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                background: '#f9fafb',
                padding: 12,
                borderRadius: 8,
                color: '#6b7280',
                marginBottom: 16
              }}
            >
              {(this.state.error?.message || String(this.state.error)).slice(0, 400)}
            </pre>
            <button
              className="btn btn-primary"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>{' '}
            <button className="btn btn-outline" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
