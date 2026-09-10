const db = require('./db');

const USE_TWILIO = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

function logSms(to, body, provider, status, error) {
  db.prepare('INSERT INTO sms_log (to_phone, message, provider, status) VALUES (?,?,?,?)')
    .run(to, body, provider, error ? 'failed' : status);
}

async function sendSms({ to, body }) {
  if (!to) return { ok: false, error: 'No phone number' };
  if (USE_TWILIO) {
    try {
      const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({ to, body, from: process.env.TWILIO_FROM });
      logSms(to, body, 'twilio', 'delivered');
      console.log(`[sms][twilio] Sent to ${to}`);
      return { ok: true, provider: 'twilio' };
    } catch (e) {
      logSms(to, body, 'twilio', null, e.message);
      console.error('[sms][twilio] failed:', e.message);
      return { ok: false, error: e.message };
    }
  }
  // Simulated mode: log to console + sms_log so the whole flow is visible
  console.log(`[sms][simulated] To ${to}: ${body}`);
  logSms(to, body, 'simulated', 'delivered');
  return { ok: true, provider: 'simulated' };
}

module.exports = { sendSms };
