import client from "./client";

// The Admin/Vendor mobile app (com.getinroute.adminvendor) signs in as either a
// company Admin or a Vendor and always talks to the SAME live backend. Every
// list below is scoped server-side from the authenticated session — the app
// never sends or trusts a company/location id.
export function adminLogin(identifier, password, locationCode) {
  return client.post("/auth/login", { identifier, password, app: "adminvendor", ...(locationCode ? { locationCode } : {}) }).then((r) => r.data);
}
export function vendorLogin(email, password, locationCode) {
  return client.post("/vendor/login", { email, password, ...(locationCode ? { locationCode } : {}) }).then((r) => r.data);
}
export function getAdminLoginLocations(identifier) {
  return client.post("/auth/admin-locations", { identifier }).then((r) => r.data);
}
export function me() { return client.get("/auth/me").then((r) => r.data); }
export function logout() { return client.post("/auth/logout").then((r) => r.data); }

// --- Admin (company) data ---
export function getAdminStats() { return client.get("/admin/stats").then((r) => r.data); }
export function getAdminEmployees(params) { return client.get("/admin/employees", { params }).then((r) => r.data); }
export function getAdminDrivers() { return client.get("/admin/drivers").then((r) => r.data); }
export function getAdminVehicles() { return client.get("/admin/vehicles").then((r) => r.data); }
export function getAdminRoutes() { return client.get("/admin/routes").then((r) => r.data); }
export function getAdminSchedules() { return client.get("/admin/schedules").then((r) => r.data); }
export function getAdminTracking() { return client.get("/admin/tracking").then((r) => r.data); }
export function getAdminAssignments() { return client.get("/admin/driver-assignments").then((r) => r.data); }
export function getNotifications() { return client.get("/notifications").then((r) => r.data); }
export function getCheckinLogs() { return client.get("/admin/checkin-logs").then((r) => r.data); }
export function getApprovals() { return client.get("/admin/approvals").then((r) => r.data); }
export function resolveApproval(id, action) { return client.post(`/admin/approvals/${id}`, { action }).then((r) => r.data); }

// --- Employees CRUD ---
export function addEmployee(data) { return client.post("/admin/employees", data).then((r) => r.data); }
export function updateEmployee(id, data) { return client.put(`/admin/users/${id}`, data).then((r) => r.data); }
export function deleteEmployee(id) { return client.delete(`/admin/users/${id}`).then((r) => r.data); }
export function setEmployeeLocation(id, company_location_id) {
  return client.put(`/admin/users/${id}/location`, { company_location_id }).then((r) => r.data);
}
export function approveEmployee(id) { return client.put(`/admin/users/${id}`, { approved: 1, status: "active" }).then((r) => r.data); }
export function suspendEmployee(id) { return client.put(`/admin/users/${id}`, { status: "suspended" }).then((r) => r.data); }

// --- Drivers CRUD ---
export function addDriver(data) { return client.post("/admin/drivers", data).then((r) => r.data); }
export function deleteDriver(id) { return client.delete(`/admin/drivers/${id}`).then((r) => r.data); }

// --- Vehicles CRUD ---
export function addVehicle(data) { return client.post("/admin/vehicles", data).then((r) => r.data); }
export function deleteVehicle(id) { return client.delete(`/admin/vehicles/${id}`).then((r) => r.data); }

// --- Routes CRUD ---
export function addRoute(data) { return client.post("/admin/routes", data).then((r) => r.data); }
export function deleteRoute(id) { return client.delete(`/admin/routes/${id}`).then((r) => r.data); }

// --- Location codes (invite codes per operational location) ---
export function getLocationCodes() { return client.get("/admin/location-codes").then((r) => r.data); }
export function issueLocationCode(company_location_id, code) {
  return client.post("/admin/location-codes", { company_location_id, ...(code ? { code } : {}) }).then((r) => r.data);
}
export function revokeLocationCode(id) { return client.post(`/admin/location-codes/${id}/revoke`).then((r) => r.data); }

// --- Locations (states / cities / locations) ---
export function getLocations() { return client.get("/admin/locations").then((r) => r.data); }
export function addState(name) { return client.post("/admin/locations/states", { name }).then((r) => r.data); }
export function addCity(state_id, name) { return client.post("/admin/locations/cities", { state_id, name }).then((r) => r.data); }
export function addLocation(city_id, name, address, code) {
  return client.post("/admin/locations/locations", { city_id, name, address, ...(code ? { code } : {}) }).then((r) => r.data);
}
export function deleteLocation(id) { return client.delete(`/admin/locations/locations/${id}`).then((r) => r.data); }

// --- Driver invites (bind a driver to a location via invite code) ---
export function getDriverInvites() { return client.get("/admin/driver-invites").then((r) => r.data); }
export function createDriverInvite(data) { return client.post("/admin/driver-invites", data).then((r) => r.data); }
export function revokeDriverInvite(id) { return client.post(`/admin/driver-invites/${id}/revoke`).then((r) => r.data); }

// --- Employee location-change requests (first-time office selection & moves) ---
export function getLocationChangeRequests(status = "pending") {
  return client.get("/admin/location-change-requests", { params: { status } }).then((r) => r.data);
}
export function approveLocationChange(id, reason) {
  return client.post(`/admin/location-change-requests/${id}/approve`, { reason: reason || "" }).then((r) => r.data);
}
export function rejectLocationChange(id, reason) {
  return client.post(`/admin/location-change-requests/${id}/reject`, { reason: reason || "" }).then((r) => r.data);
}

// --- Exports (CSV / XLSX download with session token) ---
import { API_BASE_URL, getToken } from "./client";
import * as FileSystem from "expo-file-system";
import { Share } from "react-native";

export async function downloadExport(kind, xlsx) {
  const token = await getToken();
  const ext = xlsx ? "xlsx" : "csv";
  const url = `${API_BASE_URL}/admin/export/${kind}${xlsx ? ".xlsx" : ""}`;
  const dir = (FileSystem.cacheDirectory || FileSystem.documentDirectory) + "exports/";
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch (e) { /* exists */ }
  const dest = `${dir}getinroute-${kind}-${Date.now()}.${ext}`;
  const result = await FileSystem.downloadAsync(url, dest, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (${result && result.status ? result.status : "no response"})`);
  }
  if (xlsx) {
    try {
      await Share.share({ url: result.uri, title: `getinroute-${kind}.${ext}` });
    } catch (e) { /* user cancelled */ }
  }
  return result;
}

// --- Vendor data (vendor-scoped) ---
export function getVendorDashboard() { return client.get("/vendor/dashboard").then((r) => r.data); }
export function getVendorEmployees() { return client.get("/vendor/employees").then((r) => r.data); }
export function getVendorDrivers() { return client.get("/vendor/drivers").then((r) => r.data); }
export function getVendorVehicles() { return client.get("/vendor/vehicles").then((r) => r.data); }
export function getVendorRoutes() { return client.get("/vendor/routes").then((r) => r.data); }
export function getVendorTrips() { return client.get("/vendor/trips").then((r) => r.data); }
