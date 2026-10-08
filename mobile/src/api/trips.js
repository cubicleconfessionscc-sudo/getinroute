import client from "./client";

export function getMyLiveAllotment() {
  return client.get("/schedules/allotments/live").then((r) => r.data);
}

export function getMyTrips() {
  return client.get("/trips/mine").then((r) => r.data);
}

// Driver: the trips/cab runs assigned to me.
export function getAssignedTrips() {
  return client.get("/trips/assigned").then((r) => r.data);
}

// Employee: authoritative trip/booking history from the backend (employee-scoped,
// joined with vehicle + driver + route, including check-in/check-out).
export function getTripHistory() {
  return client.get("/trips/history").then((r) => r.data);
}

// Employee: download the OFFICIAL history CSV (token-authenticated) to the device
// and return a content URI the OS can open. Server records are never modified.
export async function downloadMyHistoryCsv() {
  const res = await client.get("/employee/export-history", { responseType: "text" });
  const FileSystem = require("expo-file-system");
  const path = FileSystem.documentDirectory + "my-trip-history.csv";
  await FileSystem.writeAsStringAsync(path, typeof res.data === "string" ? res.data : String(res.data));
  return await FileSystem.getContentUriAsync(path).catch(() => path);
}

export function checkIn(tripId) {
  return client.post(`/schedules/allotments/${tripId}/checkin`).then((r) => r.data);
}

export function checkOut(tripId) {
  return client.post(`/schedules/allotments/${tripId}/checkout`).then((r) => r.data);
}

export function confirmSafeDrop(scheduleId) {
  return client.post("/employee/safety/confirm", { scheduleId }).then((r) => r.data);
}
