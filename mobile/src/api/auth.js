import Constants from "expo-constants";
import client from "./client";

// The build variant is baked into the app config at build time by eas.json /
// app.config.js ('company'/'employee' => Employee app, 'driver' => Driver app,
// 'school' => School app). The backend gates BOTH registration and login by this
// variant (enforceAppLogin / the /auth/register role check), so each build must
// announce its own identity. Hardcoding "employee" here made the Driver app send
// app=employee, so the server rejected driver sign-ups and driver logins with
// "This app is for employees...". Derive the identifier from the variant.
const VARIANT = (Constants.expoConfig?.extra?.appVariant || "company").toLowerCase();
const APP = VARIANT === "driver" ? "driver" : VARIANT === "school" ? "school" : "employee";

export function register(payload) {
  return client.post("/auth/register", { ...payload, app: APP }).then((r) => r.data);
}

export function login(email, password) {
  return client.post("/auth/login", { email, password, app: APP }).then((r) => r.data);
}

export function me() {
  return client.get("/auth/me").then((r) => r.data);
}
