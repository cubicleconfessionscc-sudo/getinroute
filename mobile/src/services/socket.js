import { io } from "socket.io-client";
import { API_BASE_URL, getToken } from "../api/client";

let socket = null;
let trackingConfig = null;
const trackingConfigListeners = new Set();

async function handleTrackingConfig(cfg) {
  trackingConfig = cfg || null;
  trackingConfigListeners.forEach((cb) => { try { cb(trackingConfig); } catch (e) {} });
}

export function onTrackingConfig(cb) {
  trackingConfigListeners.add(cb);
  if (trackingConfig) cb(trackingConfig);
  return () => trackingConfigListeners.delete(cb);
}

// Adaptive GPS ping interval (ms) sent by the server via "tracking:config".
// Falls back to 4s if the server hasn't published a config yet.
export function getTrackingIntervalMs() {
  return trackingConfig && Number.isFinite(trackingConfig.intervalSec) && trackingConfig.intervalSec > 0
    ? trackingConfig.intervalSec * 1000
    : 4000;
}

export async function connectSocket() {
  if (socket?.connected) return socket;

  const token = await getToken();
  const serverUrl = API_BASE_URL.replace(/\/api\/?$/, "");

  socket = io(serverUrl, { auth: { token } });
  socket.on("tracking:config", handleTrackingConfig);
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinTrip(tripId) {
  socket?.emit("trip:join", { tripId });
}

export function leaveTrip(tripId) {
  socket?.emit("trip:leave", { tripId });
}

// Driver only - sends current GPS + speed every tick from the location
// watcher in services/location.js
export function sendLocationUpdate(tripId, lat, lng, speedKmph) {
  socket?.emit("location:update", { tripId, lat, lng, speedKmph });
}

// Employee only - shares live GPS so the admin live map + approval queue can
// see where employees are. Throttled by callers (see EmployeeLocationsScreen).
export function sendEmployeeLocation(lat, lng) {
  socket?.emit("location:push", { lat, lng });
}

export function sendChatMessage(tripId, text) {
  socket?.emit("chat:message", { tripId, text });
}

export function updateStopStatus(tripId, stopEmployeeId, status) {
  socket?.emit("trip:statusUpdate", { tripId, stopEmployeeId, status });
}

export function updateAllotmentStop(allotmentId, employeeId, status) {
  socket?.emit("allotment:statusUpdate", { allotmentId, employeeId, status });
}
