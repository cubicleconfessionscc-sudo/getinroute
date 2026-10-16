const LEGACY_KEY = 'getinroute_token';
const roleKey = (role) => `getinroute_token_${role || 'admin'}`;
// Session tokens live in sessionStorage, which is scoped to a single browser TAB.
// That means opening the app URL in a new tab (e.g. copy/paste the link) starts
// with NO token and requires a fresh login, while a normal refresh inside the same
// tab keeps the session. localStorage is deliberately NOT used for auth tokens,
// because it is shared across every tab of the origin and would auto-login a new
// tab. Each role keeps its own key so logging into the vendor portal never
// overwrites the admin session in another tab.
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
// sessionStorage can throw in locked-down/private modes; never let auth crash the app.
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } }
export function tokenRole(t) {
  try { return JSON.parse(atob(String(t || getToken()).split('.')[1])).role || null; }
  catch { return null; }
}
export function getToken() {
  const pr = pathRole();
  if (pr) {
    const direct = ssGet(roleKey(pr));
    if (direct) return direct;
    // /admin hosts both admin and vendor sessions; use whichever exists.
    if (pr === 'admin') {
      const alt = ssGet(roleKey('vendor')) || ssGet(roleKey('admin'));
      if (alt) return alt;
    }
    const legacy = ssGet(LEGACY_KEY);
    if (legacy) return legacy;
  }
  const last = ssGet('getinroute_last_role');
  return ssGet(roleKey(last)) || ssGet(LEGACY_KEY) || '';
}
export function setToken(t) {
  const role = tokenRole(t) || 'admin';
  ssSet(roleKey(role), t);
  ssSet('getinroute_last_role', role);
  ssDel(LEGACY_KEY);
}
export function clearToken() {
  const pr = pathRole();
  if (pr) ssDel(roleKey(pr));
  ssDel(LEGACY_KEY);
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
      // Only a genuinely expired/invalid session should bounce the visitor to
      // /login. If we were never signed in (public pages such as
      // /register-company), redirecting would destroy whatever the visitor was
      // mid-way through typing — so surface the error and let the caller show it.
      const hadToken = !!token;
      clearToken();
      if (hadToken) window.location.href = '/login';
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
