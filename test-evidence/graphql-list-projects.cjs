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
  const r = await call(`{ projects { edges { node { id name services { edges { node { id name } } } } } } }`);
  console.log(JSON.stringify(r, null, 2));
}
main();
