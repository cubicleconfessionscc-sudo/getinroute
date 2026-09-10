import client from "./client";

// Driver's reported standing point (where their cab is parked at the
// office, L1..L60). Backed by vehicles.stand on the backend.
export function getStandingPoint() {
  return client.get("/driver/standing-point").then((r) => r.data);
}
export function setStandingPoint(standingPoint) {
  return client.put("/driver/standing-point", { standingPoint }).then((r) => r.data);
}

// Parking-line assignment: records a parking_events row + persists into vehicles.stand.
export function setParkingLine(line) {
  return client.post("/driver/parking-line", { line }).then((r) => r.data);
}
export function getParkingLine() {
  return client.get("/driver/parking-line").then((r) => r.data);
}

// Driver requests cancellation of an active run (files a cancel request
// for admin/vendor approval). Pass the vehicle id or the run object.
export function requestCancelRun(reason) {
  return client.post("/driver/trip", { action: "cancel", reason }).then((r) => r.data);
}

// Driver: today's trip overview (vehicle, route, rider schedule + server-run
// auto-computed next stop at { run: { phase, scheduleId, sequence, employeeName } }).
export function getDriverToday() {
  return client.get("/driver/today").then((r) => r.data);
}

// Driver: set cab live status (en_route / arrived / boarding / dropping).
export function setDriverStatus(status) {
  return client.put("/driver/status", { status }).then((r) => r.data);
}

// Driver: confirm a rider's 6-digit check-in OTP read out to them on the run.
export function confirmRiderCheckIn(scheduleId, otp) {
  return client.post("/driver/confirm-checkin", { scheduleId, otp }).then((r) => r.data);
}
