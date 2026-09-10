import client from "./client";

// Raises an SOS alert. Emits alert:new to the company's admin dashboards
// over Socket.io and push-notifies the company's admins.
export function sendSOS(payload) {
  // payload: { tripId?, lat?, lng?, note? }
  return client.post("/alerts", payload).then((r) => r.data);
}
