import client from "./client";

// The Admin/Vendor mobile app (com.getinroute.adminvendor) signs in as either a
// company Admin or a Vendor and always talks to the SAME live backend. Every
// list below is scoped server-side from the authenticated session — the app
// never sends or trusts a company/location id.
export function adminLogin(identifier, password) {
  return client.post("/auth/login", { identifier, password, app: "adminvendor" }).then((r) => r.data);
}
export function vendorLogin(email, password) {
  return client.post("/vendor/login", { email, password }).then((r) => r.data);
}
export function me() { return client.get("/auth/me").then((r) => r.data); }
export function logout() { return client.post("/auth/logout").then((r) => r.data); }

// --- Admin (company) data ---
export function getAdminStats() { return client.get("/admin/stats").then((r) => r.data); }
export function getAdminEmployees() { return client.get("/admin/employees").then((r) => r.data); }
export function getAdminDrivers() { return client.get("/admin/drivers").then((r) => r.data); }
export function getAdminVehicles() { return client.get("/admin/vehicles").then((r) => r.data); }
export function getAdminRoutes() { return client.get("/admin/routes").then((r) => r.data); }
export function getAdminSchedules() { return client.get("/admin/schedules").then((r) => r.data); }
export function getAdminTracking() { return client.get("/admin/tracking").then((r) => r.data); }
export function getAdminAssignments() { return client.get("/admin/driver-assignments").then((r) => r.data); }
export function getNotifications() { return client.get("/notifications").then((r) => r.data); }

// --- Vendor data (vendor-scoped) ---
export function getVendorDashboard() { return client.get("/vendor/dashboard").then((r) => r.data); }
export function getVendorEmployees() { return client.get("/vendor/employees").then((r) => r.data); }
export function getVendorDrivers() { return client.get("/vendor/drivers").then((r) => r.data); }
export function getVendorVehicles() { return client.get("/vendor/vehicles").then((r) => r.data); }
export function getVendorRoutes() { return client.get("/vendor/routes").then((r) => r.data); }
export function getVendorTrips() { return client.get("/vendor/trips").then((r) => r.data); }
