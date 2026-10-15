export default function Home() {
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '16px' }}>
      <div className="card">
        <h2 style={{ color: 'var(--primary)' }}>Welcome, {user.firstName || user.name || 'Employee'}</h2>
        <p style={{ color: 'var(--text2)' }}>Your trips, schedule, and notifications appear here.</p>
      </div>
    </div>
  )
}
