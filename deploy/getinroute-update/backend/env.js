/* Minimal .env loader (zero deps).
   Loads D:\GetInRoute\backend\.env at startup and fills env vars that are not
   already set. Test harnesses (test-rbac.js etc.) set DB_PATH/JWT_SECRET/PORT
   BEFORE requiring db.js, so this loader never overrides them. Values match the
   .env.example format: KEY=value, double/single-quoted values are unquoted. */
const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue;
    let val = m[2].trim();
    if (val.length >= 2 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

module.exports = process.env;