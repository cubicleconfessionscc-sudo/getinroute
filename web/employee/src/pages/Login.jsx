import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()
  const handleLogin = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch((import.meta.env.VITE_API_URL || 'https://www.getinroute.in/api') + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (data?.token) {
        localStorage.setItem('token', data.token)
        localStorage.setItem('user', JSON.stringify(data.user || {}))
        navigate('/home')
      } else {
        alert(data?.message || 'Login failed')
      }
    } catch (e) {
      alert('Network error')
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '16px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 style={{ color: 'var(--primary)', marginBottom: '8px' }}>GetInRoute Employee</h2>
        <p style={{ color: 'var(--text2)', marginBottom: '24px' }}>Sign in with your company email</p>
        <form onSubmit={handleLogin}>
          <input className="input" type="email" placeholder="Company email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ marginBottom: '12px' }} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ marginBottom: '16px' }} />
          <button className="btn-primary" style={{ width: '100%' }}>Sign In</button>
        </form>
      </div>
    </div>
  )
}
