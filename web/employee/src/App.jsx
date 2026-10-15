import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'

export default function App() {
  const token = localStorage.getItem('token')
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/home" element={token ? <Home /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to={token ? '/home' : '/login'} />} />
    </Routes>
  )
}
