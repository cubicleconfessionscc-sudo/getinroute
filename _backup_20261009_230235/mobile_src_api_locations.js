import client from "./client";

// Employee pickup/drop (nodal) point profile + admin approval status
export function getLocationProfile() {
  return client.get("/location/profile").then((r) => r.data);
}

export function updateLocationProfile(payload) {
  return client.put("/location/profile", payload).then((r) => r.data);
}
