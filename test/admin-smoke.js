const assert = require('assert');

const port = 3203;
process.env.PORT = String(port);
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';
process.env.DATABASE_REQUIRED = 'true';
process.env.GOOGLE_CLIENT_ID = 'admin-test.apps.googleusercontent.com';
process.env.SESSION_SECRET = 'admin-test-session-secret-longer-than-thirty-two-characters';
process.env.ADMIN_EMAIL = 'mhayankhan100@gmail.com';

const room = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Admin Room',
  role: 'admin',
  inviteToken: '22222222-2222-4222-8222-222222222222',
  createdAt: new Date().toISOString(),
};
let createdBy = null;
let deletedBy = null;
const database = {
  enabled: true,
  ensureUser: async () => ({}),
  getProfile: async (subject) => ({
    email: subject === 'admin-subject' ? process.env.ADMIN_EMAIL : 'member@example.com',
    name: 'Student', avatar: 'male', color: '#86efac', photo: null, profile_complete: true,
  }),
  listLibraries: async () => [room],
  createLibrary: async (subject, name) => { createdBy = subject; return { ...room, name }; },
  deleteLibrary: async (subject) => { deletedBy = subject; return room.inviteToken; },
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
    const admin = options?.headers?.authorization === 'Bearer admin-token';
    return Promise.resolve(new Response(JSON.stringify({
      sub: admin ? 'admin-subject' : 'member-subject',
      email: admin ? process.env.ADMIN_EMAIL : 'member@example.com',
      email_verified: true,
      name: admin ? 'Admin' : 'Member',
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
  throw new Error('admin test server did not start');
}

async function signIn(accessToken) {
  const response = await fetch(`http://localhost:${port}/api/auth/google`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken }),
  });
  assert.equal(response.status, 200);
  return {
    cookie: response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '),
    user: (await response.json()).user,
  };
}

(async () => {
  await waitForServer();
  const member = await signIn('member-token');
  assert.equal(member.user.isAdmin, false);
  const memberCreate = await fetch(`http://localhost:${port}/api/libraries`, {
    method: 'POST', headers: { cookie: member.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Nope' }),
  });
  assert.equal(memberCreate.status, 403, 'ordinary accounts cannot create rooms');
  const memberDelete = await fetch(`http://localhost:${port}/api/libraries/${room.id}`, {
    method: 'DELETE', headers: { cookie: member.cookie },
  });
  assert.equal(memberDelete.status, 403, 'ordinary accounts cannot delete rooms');

  const admin = await signIn('admin-token');
  assert.equal(admin.user.isAdmin, true);
  const adminState = await fetch(`http://localhost:${port}/api/auth/me`, { headers: { cookie: admin.cookie } }).then((response) => response.json());
  assert.equal(adminState.user.isAdmin, true, 'admin survives the signed session refresh');
  const adminCreate = await fetch(`http://localhost:${port}/api/libraries`, {
    method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Biology' }),
  });
  assert.equal(adminCreate.status, 201);
  assert.equal(createdBy, 'admin-subject');

  const rooms = await fetch(`http://localhost:${port}/api/libraries`, { headers: { cookie: admin.cookie } }).then((response) => response.json());
  assert.equal(rooms.libraries[0].activeCount, 0);
  const removed = await fetch(`http://localhost:${port}/api/libraries/${room.id}`, {
    method: 'DELETE', headers: { cookie: admin.cookie },
  });
  assert.equal(removed.status, 204);
  assert.equal(deletedBy, 'admin-subject');
  console.log('admin-only room management and active counts smoke test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = nativeFetch;
  server.close();
});
