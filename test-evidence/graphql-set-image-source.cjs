const fs = require('fs');
const https = require('https');
const config = JSON.parse(fs.readFileSync('C:/Users/User/.railway/config.json', 'utf8'));
const TOKEN = config.user.accessToken;
const ENDPOINT = 'https://backboard.railway.app/graphql/v2';
function call(q, v) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query: q, variables: v || {} });
    const req = https.request(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer ' + TOKEN } }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d)); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}
async function main() {
  const r = await call('mutation Connect($id: String!, $input: ServiceSourceInput!) { serviceConnect(id: $id, input: $input) { id name } }', { id: '0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5', input: { image: 'node:20-alpine' } });
  console.log('Connect:', JSON.stringify(r, null, 2));
}
main();
