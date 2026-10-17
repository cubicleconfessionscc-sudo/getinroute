import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken, tokenRole } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) return setLoading(false);
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('gir_user') || 'null'); } catch {}
    const path = tokenRole() === 'vendor' ? '/api/vendor/me' : '/api/auth/me';
    api.get(path)
      .then((r) => setUser(r.user || r))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (identifier, password, companyLocationId) => {
    let lat = null, lng = null;
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject();
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch {}
    const r = await api.post('/api/auth/login', { identifier, password, lat, lng, app: 'web', ...(companyLocationId != null && companyLocationId !== '' ? { company_location_id: companyLocationId } : {}) });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };
  const logout = () => {
    // Tell the server first so the employee/driver single-device slot (and any
    // live socket) is released — otherwise the next sign-in can be rejected.
    // Fire-and-forget: a failed logout must never trap the user signed in.
    const t = getToken();
    if (t) {
      try {
        fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
      } catch {}
    }
    clearToken();
    localStorage.removeItem('gir_user');
    setUser(null);
    window.location.href = '/login';
  };
  return <AuthCtx.Provider value={{ user, setUser, login, logout, loading }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
