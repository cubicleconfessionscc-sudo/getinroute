/* k6 load test — HTTP (dashboard reads) + Socket.IO WebSocket connects.
   Login happens ONCE in setup() (so the per-IP login rate-limit does not distort
   the load numbers); each VU reuses the token for reads + a WS connection.
   Run:  k6 run -e BASE=http://127.0.0.1:9600 -e ADMIN_EMAIL=... -e ADMIN_PW=... test/k6-load.js
*/
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://127.0.0.1:4000';
const EMAIL = __ENV.ADMIN_EMAIL || 'load@getinroute.com';
const PW = __ENV.ADMIN_PW || 'LoadPass123!';
const WS_HOLD_MS = Number(__ENV.WS_HOLD_MS || 1500);

const readLatency = new Trend('read_latency', true);
const errors = new Rate('op_errors');
const wsConns = new Counter('ws_connections');

export const options = {
  stages: [
    { duration: '5s', target: 20 },
    { duration: '10s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    op_errors: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
  },
};

export function setup() {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ identifier: EMAIL, password: PW, app: 'web' }), { headers: { 'Content-Type': 'application/json' } });
  let token = '';
  try { token = r.json('token'); } catch (e) {}
  return { token };
}

export default function (data) {
  const token = data.token;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  for (const p of ['/api/admin/stats', '/api/admin/tracking', '/api/admin/driver-assignments']) {
    const r = http.get(`${BASE}${p}`, { headers });
    readLatency.add(r.timings.duration);
    errors.add(r.status >= 400);
  }

  if (token) {
    const wsUrl = `${BASE.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const res = ws.connect(wsUrl, {}, (socket) => {
      socket.on('open', () => wsConns.add(1));
      socket.on('message', (msg) => {
        if (msg.startsWith('0')) socket.send(`40{"token":"${token}"}`);
        else if (msg.startsWith('40')) socket.send('42["location:update",{"lat":12.97,"lng":77.6,"speedKmph":30}]');
      });
      socket.setTimeout(() => socket.close(), WS_HOLD_MS);
    });
    check(res, { 'ws 101': (r) => r && r.status === 101 });
  }
  sleep(0.2);
}
