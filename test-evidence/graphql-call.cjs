const fs = require('fs');
const https = require('https');

const TOKEN = 'CXldevX4g31BhZRVzu-5j8DkBLevG1DXnejj_HRnJYM';
const ENDPOINT = 'https://backboard.railway.app/graphql/v2';

function call(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables: variables || {} });
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer ' + TOKEN
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const args = process.argv.slice(2);
const query = args[0];
const variables = args[1] ? JSON.parse(args[1]) : undefined;
call(query, variables).then((r) => {
  console.log(JSON.stringify(r, null, 2));
}).catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
