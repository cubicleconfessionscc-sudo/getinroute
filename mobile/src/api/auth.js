import client from "./client";

export function register(payload) {
  // payload: { name, email, phone, password, role: "employee"|"driver", employeeId, ... }
  return client.post("/auth/register", payload).then((r) => r.data);
}

export function login(email, password) {
  return client.post("/auth/login", { email, password }).then((r) => r.data);
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
