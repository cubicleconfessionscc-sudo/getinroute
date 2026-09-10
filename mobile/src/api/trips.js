import client from "./client";

// Employee
export function getMyTrips() {
  return client.get("/trips/mine").then((r) => r.data);
}
export function checkIn(tripId) {
  return client.post(`/trips/${tripId}/checkin`).then((r) => r.data);
}
export function checkOut(tripId) {
  return client.post(`/trips/${tripId}/checkout`).then((r) => r.data);
}
export function confirmSafeDrop(tripId) {
  return client.post(`/trips/${tripId}/safedrop`).then((r) => r.data);
}
export function exportMyHistory() {
  // Returns a download URL the app can open in-browser or via a file
  // download library; the endpoint itself streams the .xlsx.
  return `${client.defaults.baseURL}/trips/mine/export`;
}

// Driver
export function getAssignedTrips() {
  return client.get("/trips/assigned").then((r) => r.data);
}
export function getTrip(tripId) {
  return client.get(`/trips/${tripId}`).then((r) => r.data);
}

// Shared
export function submitFeedback(tripId, rating, comment, reasons) {
  return client.post("/feedback", { tripId, rating, comment, reasons }).then((r) => r.data);
}
export function raiseSOS(tripId, lat, lng, note) {
  return client.post("/alerts", { tripId, lat, lng, note }).then((r) => r.data);
}
