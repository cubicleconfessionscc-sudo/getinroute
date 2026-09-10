import client from "./client";

// Look up a company by email domain (employees) or invite code (drivers),
// used by the register screen to validate before submitting.
export function lookupCompany(params) {
  return client.get("/company/lookup", { params }).then((r) => r.data);
}

export function getMyCompany() {
  return client.get("/company/me").then((r) => r.data);
}
