const fs = require('fs');
const https = require('https');
const config = JSON.parse(fs.readFileSync('C:/Users/User/.railway/config.json', 'utf8'));
const TOKEN = config.user.accessToken;
function call(q, v) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query: q, variables: v || {} });
    const req = https.request('https://backboard.railway.app/graphql/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer ' + TOKEN } }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d)); } });
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}
async function main() {
  const q = '{ __type(name: "Builder") { enumValues { name } } }';
  const r = await call(q);
  if (r.data && r.data.__type) {
    r.data.__type.enumValues.forEach(v => console.log(v.name));
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
}
main().catch(e => console.error(e.message));
