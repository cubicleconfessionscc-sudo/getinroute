import client from "./client";

// Employee-initiated location change requests (Part 4.3).
export function listMyLocationChangeRequests() {
  return client.get("/employee/location-change-requests/me").then((r) => r.data);
}
export function createLocationChangeRequest(payload) {
  return client.post("/employee/location-change-requests", payload).then((r) => r.data);
}
export function cancelLocationChangeRequest(id) {
  return client.post(`/employee/location-change-requests/${id}/cancel`).then((r) => r.data);
}
