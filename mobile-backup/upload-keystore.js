const fs = require('fs');
const https = require('https');
const os = require('os');
const state = JSON.parse(fs.readFileSync(os.homedir() + '/.expo/state.json', 'utf8'));
const session = state.auth.sessionSecret;

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({ hostname: 'api.expo.dev', path: '/graphql', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'expo-session': session, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { let data = ''; res.on('data', (chunk) => data += chunk); res.on('end', () => resolve(JSON.parse(data))); });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function main() {
  // Delete the wrongly-created keystore first
  console.log('Deleting wrong-account keystore...');
  const del = await gql(`mutation { androidKeystore { deleteAndroidKeystore(id: "2ea2c974-7e3e-482b-903a-dcdb5b4dc7be") { id } } }`);
  console.log('Deleted:', JSON.stringify(del));

  // Create under clementedwins-team account
  const p12 = fs.readFileSync('C:/Users/User/Documents/upload-keystore.p12');
  const ks64 = p12.toString('base64');
  
  console.log('Creating keystore under clementedwins-team...');
  const create = await gql(`mutation { androidKeystore { createAndroidKeystore(accountId: "597ce61c-892d-4a61-9fd6-e52f543411aa" androidKeystoreInput: { base64EncodedKeystore: "${ks64}" keystorePassword: "getinroute" keyAlias: "getinroute" keyPassword: "getinroute" }) { id keyAlias sha1CertificateFingerprint sha256CertificateFingerprint } } }`);
  console.log('Created:', JSON.stringify(create, null, 2));

  const newId = create.data?.androidKeystore?.createAndroidKeystore?.id;
  if (!newId) { console.log('FAILED'); return; }

  // Link it to build credentials
  console.log('Linking to build credentials...');
  const link = await gql(`mutation { androidAppBuildCredentials { setKeystore(id: "51000aa5-c156-4bee-89fb-fa18f4bba835" keystoreId: "${newId}") { id androidKeystore { id keyAlias sha1CertificateFingerprint } } } }`);
  console.log('Linked:', JSON.stringify(link, null, 2));
}
main().catch(console.error);
