const LEGACY_KEY = 'getinroute_token';
const roleKey = (role) => `getinroute_token_${role || 'admin'}`;
// Resolve which portal the current URL belongs to so each role keeps its own
// session token in localStorage (P1.18). Without this, logging into the vendor
// portal would overwrite the admin token and break the admin tab.
const PATH_ROLES = [
  ['/admin', 'admin'], ['/vendor', 'vendor'], ['/parent', 'parent'],
  ['/school', 'school'], ['/driver', 'driver'], ['/employee', 'employee'],
  ['/app', 'employee']
];
function pathRole() {
  const p = window.location.pathname;
  for (const [prefix, role] of PATH_ROLES) {
    if (p === prefix || p.startsWith(prefix + '/')) return role;
  }
  return null;
}
export function tokenRole(t) {
  try { return JSON.parse(atob(String(t || getToken()).split('.')[1])).role || null; }
  catch { return null; }
}
export function getToken() {
  const pr = pathRole();
  if (pr) {
    const direct = localStorage.getItem(roleKey(pr));
    if (direct) return direct;
    // /admin hosts both admin and vendor sessions; use whichever exists.
    if (pr === 'admin') {
      const alt = localStorage.getItem(roleKey('vendor')) || localStorage.getItem(roleKey('admin'));
      if (alt) return alt;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return legacy;
  }
  const last = localStorage.getItem('getinroute_last_role');
  return localStorage.getItem(roleKey(last)) || localStorage.getItem(LEGACY_KEY) || '';
}
export function setToken(t) {
  const role = tokenRole(t) || 'admin';
  localStorage.setItem(roleKey(role), t);
  localStorage.setItem('getinroute_last_role', role);
  localStorage.removeItem(LEGACY_KEY);
}
export function clearToken() {
  const pr = pathRole();
  if (pr) localStorage.removeItem(roleKey(pr));
  localStorage.removeItem(LEGACY_KEY);
}

const REQUEST_TIMEOUT_MS = 20000;

async function request(path, { method = 'GET', body, params, timeout = REQUEST_TIMEOUT_MS } = {}) {
  let url = path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += '?' + qs;
  }
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    });
  } catch (err) {
    if (ctrl && ctrl.signal.aborted) throw new Error('Request timed out');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.href = '/login';
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const api = {
  get: (p, params) => request(p, { params }),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' })
};

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }
  return [];
}

export async function downloadCsv(path, filename) {
  await downloadFile(path, filename);
}

export async function downloadFile(path, filename) {
  const token = getToken();
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl ? ctrl.signal : undefined });
  } catch (err) {
    if (ctrl && ctrl.signal.aborted) throw new Error('Download timed out');
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
