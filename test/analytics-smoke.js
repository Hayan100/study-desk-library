const assert = require('assert');

const port = 3202;
process.env.PORT = String(port);
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';
process.env.DATABASE_REQUIRED = 'true';
process.env.GOOGLE_CLIENT_ID = 'analytics-test.apps.googleusercontent.com';
process.env.SESSION_SECRET = 'analytics-test-session-secret-longer-than-thirty-two-characters';

const today = new Date();
const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() - (6 - index));
  return { date: date.toISOString().slice(0, 10), focusSeconds: 0 };
});
const emptyAnalytics = {
  totalFocusSeconds: 0,
  todayFocusSeconds: 0,
  completedSessionCount: 0,
  currentStreak: 0,
  lastSevenDays,
  recentSessions: [],
};
let analyticsSubject = null;
const database = {
  enabled: true,
  ensureUser: async () => ({}),
  getProfile: async () => ({
    name: 'Owner', avatar: 'male', color: '#86efac', photo: null, profile_complete: true,
  }),
  getStudyAnalytics: async (subject) => { analyticsSubject = subject; return emptyAnalytics; },
  close: async () => {},
};
const databasePath = require.resolve('../database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: database };

class OAuth2Client {
  async getTokenInfo() {
    return { aud: process.env.GOOGLE_CLIENT_ID, expiry_date: Date.now() + 60000 };
  }
}
const googlePath = require.resolve('google-auth-library');
require.cache[googlePath] = {
  id: googlePath, filename: googlePath, loaded: true, exports: { OAuth2Client },
};

const nativeFetch = global.fetch;
global.fetch = (input, options) => {
  if (String(input) === 'https://openidconnect.googleapis.com/v1/userinfo') {
    return Promise.resolve(new Response(JSON.stringify({
      sub: 'signed-in-owner', email: 'owner@example.com', email_verified: true, name: 'Owner',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return nativeFetch(input, options);
};

const { server } = require('../server');

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('analytics test server did not start');
}

(async () => {
  await waitForServer();
  const denied = await fetch(`http://localhost:${port}/api/analytics?userId=someone-else`);
  assert.equal(denied.status, 401, 'analytics requires a signed-in account');

  const signIn = await fetch(`http://localhost:${port}/api/auth/google`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: 'test-token' }),
  });
  assert.equal(signIn.status, 200);
  const cookies = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const response = await fetch(`http://localhost:${port}/api/analytics?userId=someone-else`, {
    headers: { cookie: cookies },
  });
  assert.equal(response.status, 200);
  assert.equal(analyticsSubject, 'signed-in-owner', 'analytics ownership comes from the signed session');
  assert.deepEqual((await response.json()).analytics, emptyAnalytics, 'empty history returns useful zero values');
  console.log('analytics ownership and empty-history smoke test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = nativeFetch;
  server.close();
});
