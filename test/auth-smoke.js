const assert = require('assert');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const missingSecrets = spawnSync(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', AUTH_REQUIRED: 'true', GOOGLE_CLIENT_ID: '', SESSION_SECRET: '' },
  encoding: 'utf8',
});
assert.notEqual(missingSecrets.status, 0, 'production must fail closed when authentication secrets are missing');

const port = 3199;
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    AUTH_REQUIRED: 'true',
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('authentication test server did not start');
}

function unauthenticatedSocketIsRejected() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`);
    const timeout = setTimeout(() => reject(new Error('unauthenticated socket was not rejected')), 3000);
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      if (!data.startsWith('44')) return;
      clearTimeout(timeout);
      ws.close();
      resolve(JSON.parse(data.slice(2)).message);
    };
    ws.onerror = reject;
  });
}

(async () => {
  await waitForServer();
  const state = await fetch(`http://localhost:${port}/api/auth/me`).then((response) => response.json());
  assert.equal(state.enabled, true);
  assert.equal(state.user, null);

  const missing = await fetch(`http://localhost:${port}/api/auth/google`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(missing.status, 400);

  const invalid = await fetch(`http://localhost:${port}/api/auth/google`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'not-a-token' }),
  });
  assert.equal(invalid.status, 401);
  assert.equal(await unauthenticatedSocketIsRejected(), 'authentication required');
  console.log('Google authentication failure-path smoke test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => child.kill());
