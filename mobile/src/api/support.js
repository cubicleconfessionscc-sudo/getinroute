import client from "./client";

// Help-line contact details (phone + email) for the signed-in user's
// company. Cached per launch so the home screens can render the "Call
// helpline" action without a network round-trip every time.
let cachedConfig = null;

export function sendHelpMessage(payload) {
  // payload: { name, email, message, companyId }
  // Emails the company's help-line inbox (company.supportEmail set by the
  // admin in the dashboard), or the platform default when no company is set.
  return client.post("/support/contact", payload).then((r) => r.data);
}

export function getSupportConfig() {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  return client.get("/support/config").then((r) => {
    cachedConfig = r.data;
    return cachedConfig;
  });
}
