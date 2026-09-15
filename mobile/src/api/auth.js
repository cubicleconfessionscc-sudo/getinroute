import client from "./client";
import { appId } from "../services/startup";

export function register(payload) {
  // payload: { name, email, phone, password, role: "employee"|"driver", employeeId, ... }
  return client.post("/auth/register", { ...payload, app: appId() }).then((r) => r.data);
}

export function login(email, password) {
  // `app` tells the backend which build this is (employee/driver/school) so it
  // can enforce role isolation server-side — the client UI is not the gate.
  return client.post("/auth/login", { email, password, app: appId() }).then((r) => r.data);
}

export function me() {
  return client.get("/auth/me").then((r) => r.data);
}

export function forgotPassword(email) {
  return client.post("/auth/forgot-password", { email }).then((r) => r.data);
}

export function resetPassword(email, token, newPassword) {
  return client
    .post("/auth/reset-password", { email, token, newPassword })
    .then((r) => r.data);
}
