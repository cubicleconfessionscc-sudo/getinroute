import client from "./client";

export function register(payload) {
  return client.post("/auth/register", { ...payload, app: "employee" }).then((r) => r.data);
}

export function login(email, password) {
  return client.post("/auth/login", { email, password, app: "employee" }).then((r) => r.data);
}

export function me() {
  return client.get("/auth/me").then((r) => r.data);
}
