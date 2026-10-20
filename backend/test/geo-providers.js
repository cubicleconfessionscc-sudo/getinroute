/* Geo provider honesty: a configured-but-rejected Google key (billing disabled,
   referer-restricted key, disabled API) must not be reported as "google" and
   must not be retried on every request. The first auth/billing failure opens a
   circuit for the process; every later call goes straight to the free
   Photon/OSRM provider.
   Run: node test/geo-providers.js */
const path = require('path');
const fs = require('fs');
const os = require('os');

const DB_FILE = path.join(os.tmpdir(), `gir-geo-providers-${Date.now()}.db`);
process.env.DB_PATH = DB_FILE;
process.env.GOOGLE_MAPS_API_KEY = 'mock-google-key';
process.env.GEOCODER_URL = 'https://photon.test';
process.env.ROUTING_URL = 'https://osrm.test';

let passed = 0, failed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('maps.googleapis.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'REQUEST_DENIED',
          error_message: 'You must enable Billing on the Google Cloud project at https://console.cloud.google.com/billing/linkedaccount?project=mock'
        })
      };
    }
    if (u.includes('photon.test')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            properties: { name: 'Photon Road', city: 'Bengaluru', state: 'Karnataka', postcode: '560001', country: 'India', osm_id: 42, osm_type: 'W' },
            geometry: { coordinates: [77.5946, 12.9716] }
          }]
        })
      };
    }
    throw new Error('unexpected fetch ' + u);
  };

  try {
    require(path.join(__dirname, '..', 'db')); // creates schema in the temp DB
    const { geocodeSearch, geocodeReverse, calculateRoute, effectiveProviders } = require(path.join(__dirname, '..', 'geo'));

    check('with a configured key the first report claims google', effectiveProviders().geocoding === 'google', effectiveProviders());

    const first = await geocodeSearch('Bengaluru');
    check('first search still returns results (Google fails -> Photon serves)', Array.isArray(first) && first.length === 1 && first[0].address.includes('Photon Road'), first);
    check('first search attempted Google once', calls.some((u) => u.includes('maps.googleapis.com')));
    check('circuit opens after the auth/billing failure', effectiveProviders().geocoding === 'photon' && effectiveProviders().routing === 'google', effectiveProviders());

    calls.length = 0;
    const second = await geocodeSearch('Whitefield');
    check('second search skips Google entirely', !calls.some((u) => u.includes('maps.googleapis.com')) && calls.some((u) => u.includes('photon.test')), calls);
    check('second search still serves results from Photon', second.length === 1 && second[0].lat === 12.9716);

    calls.length = 0;
    const rev = await geocodeReverse(12.9716, 77.5946);
    check('reverse geocode also bypasses Google after the circuit opens', rev && rev.address.includes('Photon Road') && !calls.some((u) => u.includes('maps.googleapis.com')), { rev, calls });

    check('routing still reports google while healthy (independent circuit)', effectiveProviders().routing === 'google');

    await calculateRoute([{ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.60 }], { useCache: false }).catch(() => {});
    check('routing circuit also opens on an auth/billing failure', effectiveProviders().routing === 'osrm', effectiveProviders());
  } finally {
    global.fetch = originalFetch;
    await sleep(200);
    try { require(path.join(__dirname, '..', 'db')).close(); } catch (e) {}
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + s); } catch (e) {} }
  }

  console.log(`\nGEO PROVIDERS: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
