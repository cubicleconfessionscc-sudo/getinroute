// Socket.IO liveness probe (Engine.IO polling handshake - no extra deps).
// Usage: node socket-check.js [port]
const port = process.argv[2] || '4000';
const url = `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`;

fetch(url)
  .then(async r => {
    const t = await r.text();
    if (r.ok && /^0\{/.test(t) && t.includes('sid')) {
      console.log('Socket.IO: OK (Engine.IO session acquired) at ' + url);
      process.exit(0);
    }
    console.log('Socket.IO probe failed: HTTP ' + r.status + ' ' + String(t).slice(0, 120));
    process.exit(1);
  })
  .catch(e => {
    console.log('Socket.IO probe failed: ' + e.message);
    process.exit(1);
  });