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
  const q1 = '{ serviceInstance(serviceId: "0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5", environmentId: "7e6c890a-b180-4b49-a42e-dd804ea39cac") { rootDirectory builder startCommand dockerfilePath healthcheckPath railwayConfigFile source { repo image } } }';
  const r1 = await call(q1);
  console.log('BEFORE:', JSON.stringify(r1.data.serviceInstance, null, 2));

  const q2 = 'mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }';
  const vars = {
    serviceId: '0b2b4ce3-d5a5-4400-ad6b-5356e4931cf5',
    environmentId: '7e6c890a-b180-4b49-a42e-dd804ea39cac',
    input: {
      rootDirectory: '.',
      builder: null,
      dockerfilePath: 'Dockerfile',
      startCommand: 'node server.js',
      healthcheckPath: '/health',
      healthcheckTimeout: 100
    }
  };
  const r2 = await call(q2, vars);
  console.log('UPDATE:', JSON.stringify(r2, null, 2));

  const r3 = await call(q1);
  console.log('AFTER:', JSON.stringify(r3.data.serviceInstance, null, 2));
}
main().catch(e => console.error(e.message));
