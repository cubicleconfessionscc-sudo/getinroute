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
  const q = '{ __type(name: "ServiceInstanceUpdateInput") { inputFields { name type { name kind ofType { name kind } } } } }';
  const r = await call(q);
  if (r.data && r.data.__type) {
    r.data.__type.inputFields.forEach(f => {
      let t = f.type;
      let typeName = t.name;
      while (!typeName && t.ofType) { t = t.ofType; typeName = t.name; }
      console.log(f.name + ': ' + (typeName || t.kind));
    });
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
}
main().catch(e => console.error(e.message));
