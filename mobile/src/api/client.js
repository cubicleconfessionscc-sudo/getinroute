import axios from "axios";
import { handleOffline, setSender, flush, markOnline, cachePut } from "../services/offlineQueue";

// Point this at your deployed GetInRoute backend. Everything in the app
// (axios + the socket URL, which is derived by stripping "/api") follows this.
// Local/dev builds override it at bundle time with EXPO_PUBLIC_API_URL, e.g.:
//   EXPO_PUBLIC_API_URL=http://192.168.1.10:4000 expo start
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://www.getinroute.in/api";

// expo-secure-store is a native module. Loading it lazily (inside each call)
// means a binary whose native side predates the JS can't blank the app at
// import time - token storage would just fail loudly on use instead.
let SecureStoreModule = null;
function requireSecureStore() {
  if (SecureStoreModule === null) {
    try {
      SecureStoreModule = require("expo-secure-store");
    } catch {
      SecureStoreModule = false;
    }
  }
  return SecureStoreModule;
}

export const TOKEN_KEY = "gir_token";
export const TOKEN_EXP_KEY = "gir_token_exp";

const client = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ---- Offline sync wiring (see services/offlineQueue.js) ----
// Retry sender replays queued writes with the user's token but WITHOUT the
// interceptors, so a network failure there keeps the item queued instead of
// recursively re-queuing it.
setSender(async (method, url, data) => {
  const token = await getToken();
  const res = await axios.request({
    method,
    url,
    data: data === undefined ? undefined : data,
    headers: {
      Authorization: token ? `Bearer ${token}` : undefined,
      "Content-Type": "application/json"
    },
    timeout: 15000
  });
  return res.data;
});

client.interceptors.response.use(
  async (res) => {
    markOnline();
    // Cache successful GETs so screens keep showing last-known data offline.
    if (String(res.config.method || "get").toLowerCase() === "get") {
      cachePut({ baseURL: res.config.baseURL, url: res.config.url, params: res.config.params }, res.data).catch(() => {});
    }
    flush().catch(() => {});
    return res;
  },
  async (err) => {
    if (err.response) return Promise.reject(err); // server answered: surface the real error
    const fallback = await handleOffline(err, err.config);
    if (fallback) {
      // Mirror the shape of a successful axios response so existing
      // callers (`res.data`, `.then(r => r)`) keep working while offline.
      return { data: fallback, status: 200, statusText: "OK", headers: {}, config: err.config };
    }
    const offlineError = new Error("You are offline. Check your connection and retry.");
    offlineError.offline = true;
    offlineError.cause = err;
    return Promise.reject(offlineError);
  }
);

// Decode the JWT `exp` claim (seconds since epoch) so the app can show the
// user how long their session stays valid and can pre-emptively clear
// expired tokens.
export function decodeJwtExp(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(json);
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function getStore() {
  return requireSecureStore();
}

export async function saveToken(token) {
  try {
    const store = getStore();
    if (!store) throw new Error("SecureStore unavailable");
    await store.setItemAsync(TOKEN_KEY, token);
    const exp = decodeJwtExp(token);
    if (exp) {
      await store.setItemAsync(TOKEN_EXP_KEY, String(exp));
    } else {
      await store.deleteItemAsync(TOKEN_EXP_KEY);
    }
  } catch (err) {
    // Token persistence is load-bearing: reset to a known-clean state so a
    // half-saved session can never wedge the app.
    console.error("saveToken failed:", err);
    throw err;
  }
}

export async function clearToken() {
  try {
    const store = getStore();
    if (!store) return;
    await store.deleteItemAsync(TOKEN_KEY);
    await store.deleteItemAsync(TOKEN_EXP_KEY);
  } catch {
    // Best-effort cleanup.
  }
}

export async function getToken() {
  try {
    const store = getStore();
    if (!store) return null;
    return await store.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getTokenExpiry() {
  try {
    const store = getStore();
    if (!store) return null;
    const raw = await store.getItemAsync(TOKEN_EXP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

// Whole days left until the stored session expires (null when unknown/absent).
export async function getSessionDaysLeft() {
  const exp = await getTokenExpiry();
  if (!exp || exp <= 0) return null;
  const ms = exp - Date.now();
  if (ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 86400000));
}

export default client;
