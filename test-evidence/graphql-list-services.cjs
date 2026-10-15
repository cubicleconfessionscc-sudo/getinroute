const fs = require('fs');
const https = require('https');

const config = JSON.parse(fs.readFileSync('C:/Users/User/.railway/config.json', 'utf8'));
const TOKEN = config.user.accessToken;
const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

function call(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables: variables || {} });
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer ' + TOKEN }
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const r = await call(`{ project(id: "df871066-14b2-4fbc-b218-1782d72063be") { id name services { edges { node { id name serviceInstances { edges { node { id } } } } } } } }`);
  console.log(JSON.stringify(r, null, 2));
}
main();
