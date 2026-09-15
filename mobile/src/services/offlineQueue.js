import * as FileSystem from "expo-file-system";

// Offline sync queue for the GetInRoute mobile apps.
//
// Design (root-cause, no new native deps):
//  - WRITE requests (POST/PUT/DELETE) that fail because the device is offline
//    are queued to disk (expo-file-system, already bundled) and replayed later.
//  - READ requests fall back to a per-URL disk cache while offline so screens
//    keep showing the last-known data instead of failing.
//  - A lightweight module-level store lets screens render an offline banner
//    and a "Pending Sync" count; anyone can trigger flush().
//
// Only network-level failures are queued. Real server errors (401/400/422/500)
// are never queued - those must surface to the user immediately.

const FILE = FileSystem.documentDirectory + "offline_sync.json";
const CACHE_DIR = FileSystem.documentDirectory + "gir_cache/";
const FLUSH_MS = 20000; // belt & braces; flushes also run opportunistically

let state = { pending: 0, syncing: false, lastSyncedAt: null, online: true };
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn({ ...state }); } catch (e) {}
  }
}

function readQueue() {
  try {
    const raw = FileSystem.readAsStringSync(FILE);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(q) {
  try {
    FileSystem.writeAsStringSync(FILE, JSON.stringify(q));
  } catch (e) {
    console.error("offline queue write failed:", e);
  }
  state.pending = q.length;
  notify();
}

export function getSyncState() {
  return { ...state };
}

export function subscribeSync(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

let flushTimer = null;
export function startSyncLoop() {
  if (flushTimer) return flushTimer;
  flushTimer = setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
  flush().catch(() => {});
  return flushTimer;
}
export function stopSyncLoop() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
}

function cacheGet(normalizedConfig) {
  try {
    if (!FileSystem.getInfoSync(CACHE_DIR).exists) return null;
    const key = normalizedConfig.url.replace(/[^A-Za-z0-9_-]/g, "_");
    const f = CACHE_DIR + key + ".json";
    if (!FileSystem.getInfoSync(f).exists) return null;
    return JSON.parse(FileSystem.readAsStringSync(f));
  } catch (e) {
    return null;
  }
}

export function cachePut(normalizedConfig, data) {
  try {
    if (!FileSystem.getInfoSync(CACHE_DIR).exists) FileSystem.makeDirectorySync(CACHE_DIR, { intermediates: true });
    const key = normalizedConfig.url.replace(/[^A-Za-z0-9_-]/g, "_");
    FileSystem.writeAsStringSync(CACHE_DIR + key + ".json", JSON.stringify({ at: Date.now(), data }));
  } catch (e) {
    // Cache is best-effort.
  }
}

// Caller shapes the axios.then callback with `config` (safe url/params) so the
// cache key stays stable and never embeds secrets.
export function readCached(normalizedConfig) {
  return cacheGet(normalizedConfig);
}

function enqueue(req) {
  const q = readQueue();
  q.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), method: req.method, url: req.url, data: req.data, ts: Date.now(), attempts: 0 });
  writeQueue(q);
}

// Replay a queued write via the injected sender (bypasses the axios interceptor
// so a failure here keeps the item queued). Returns true on success.
async function replayItem(item) {
  try {
    const res = await sender(item.method, item.url, item.data);
    if (res && typeof res === "object" && (res.ok === false || res.error)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// send(method, url, data) must be injected once from client.js to avoid a
// circular import (client -> offlineQueue -> client).
let sender = null;
export function setSender(fn) { sender = fn; }

export async function flush() {
  if (!sender || state.syncing) return 0;
  const q = readQueue();
  if (!q.length) return 0;
  state.syncing = true;
  notify();
  const next = [];
  let synced = 0;
  for (const item of q) {
    if (item.attempts >= 6) { next.push(item); continue; } // keep for manual retry from Pending Sync
    const ok = await replayItem(item);
    if (ok) synced++;
    else { next.push({ ...item, attempts: item.attempts + 1 }); }
  }
  writeQueue(next);
  state.syncing = false;
  state.lastSyncedAt = new Date().toISOString();
  state.online = q.length > synced ? false : true;
  notify();
  return synced;
}

// Wire into the axios response interceptor:
//  - network failure on a write  -> queue it, resolve a friendly offline result.
//  - network failure on a read   -> return cached copy (stale) or rethrow a
//                                   tagged error the UI can render as "offline".
export async function handleOffline(err, config) {
  const isNetwork = !err.response;
  if (!isNetwork) return null; // server answered: it is not an offline problem
  state.online = false;
  notify();
  const method = String((config && config.method) || "get").toLowerCase();
  const norm = { baseURL: config.baseURL, url: config.url, params: config.params };
  if (method !== "get") {
    enqueue({ method: method.toUpperCase(), url: config.baseURL + config.url, data: config.data ? JSON.parse(JSON.stringify(config.data)) : null });
    return { ok: true, offline: true, queued: Date.now().toString(36), message: "Saved offline — will sync when you are back online" };
  }
  const cached = cacheGet(norm);
  if (cached) {
    return { ...cached.data, stale: true, offline: true };
  }
  return null; // caller rethrows as an offline error
}

export function markOnline() {
  state.online = true;
  notify();
}

export async function queueLength() {
  return readQueue().length;
}

export async function pendingList() {
  return readQueue().reverse();
}

export async function clearPending() {
  writeQueue([]);
}