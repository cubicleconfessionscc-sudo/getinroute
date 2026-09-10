import client from "./client";

// Shift slots + booking cutoff the admin configured
export function getScheduleConfig() {
  return client.get("/schedules/config").then((r) => r.data);
}

// Employee's own cab schedules
export function getMySchedules() {
  return client.get("/schedules/mine").then((r) => r.data);
}

export function createSchedule(payload) {
  return client.post("/schedules", payload).then((r) => r.data);
}

export function cancelSchedule(id) {
  return client.delete(`/schedules/${id}`).then((r) => r.data);
}

// Which cab got allotted to me (vehicle, driver, drop position)
export function getMyAllotments() {
  return client.get("/schedules/allotments").then((r) => r.data);
}

// Driver: the cab runs assigned to me (vehicle + drop sequence, in order)
export function getMyDriverAllotments() {
  return client.get("/schedules/allotments/driver").then((r) => r.data);
}

// Employee: my live / upcoming allotment with the driver's live GPS position
export function getMyLiveAllotment() {
  return client.get("/schedules/allotments/live").then((r) => r.data);
}

// Employee: swipe check-in / check-out / SafeDrop on an allotted run
export function allotmentCheckIn(id) {
  return client.post(`/schedules/allotments/${id}/checkin`).then((r) => r.data);
}
export function allotmentCheckOut(id) {
  return client.post(`/schedules/allotments/${id}/checkout`).then((r) => r.data);
}

// Employee: Night Safety Drop — confirm reached home / raise help request.
// These use the run's scheduleId (returned by getMyLiveAllotment()).
export function confirmReachedHome(scheduleId) {
  return client.post("/employee/safety/confirm", { scheduleId }).then((r) => r.data);
}
export function reportNotReachedHome(scheduleId, { lat = null, lng = null } = {}) {
  return client.post("/employee/safety/not-reached", { scheduleId, lat, lng }).then((r) => r.data);
}
export function getMySafetyStatus() {
  return client.get("/employee/safety/my").then((r) => r.data);
}

// Driver: end an allotted run once everyone is picked up / the office is reached
export function completeRun(id) {
  return client.post(`/schedules/allotments/${id}/complete`).then((r) => r.data);
}
