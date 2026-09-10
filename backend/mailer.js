const nodemailer = require('nodemailer');

let transporter = null;

// Privacy-first: unless SMTP_HOST + SMTP_USER are set (a server the company
// controls), ALL mail stays inside this server and is written to the console
// only. Nothing is ever sent to a third-party inbox.
async function initMailer() {
  const useSMTP = process.env.SMTP_HOST && process.env.SMTP_USER;
  if (useSMTP) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    console.log('[mailer] SMTP configured — email will be delivered via the company SMTP server.');
    return;
  }
  transporter = null;
  console.log('[mailer] No SMTP configured — mail is logged to the console only (nothing leaves this server).');
}

async function sendMail({ to, subject, html }) {
  if (!transporter) {
    console.log('\n[mailer][console] To: ' + to + ' | ' + subject);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('[mailer][console] (console-only mode: no email was sent outside this server)\n');
    return { consoleOnly: true };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@getinroute.app',
      to, subject, html
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[mailer] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { initMailer, sendMail };
