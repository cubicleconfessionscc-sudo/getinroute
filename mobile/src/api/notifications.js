import client from "./client";

export function getNotifications() {
  return client.get("/notifications").then((r) => r.data);
}

export function markNotificationsRead(ids) {
  return client.post("/notifications/read", ids && ids.length ? { ids } : {}).then((r) => r.data);
}
