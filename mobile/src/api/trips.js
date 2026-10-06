import client from "./client";

export function getMyLiveAllotment() {
  return client.get("/schedules/allotments/live").then((r) => r.data);
}

export function getMyTrips() {
  return client.get("/trips/mine").then((r) => r.data);
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
