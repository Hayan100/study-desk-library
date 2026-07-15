'use strict';

const express = require('express');
const fs = require('fs');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const database = require('./database');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === 'true';
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || '');
const AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && SESSION_SECRET.length >= 32);
const DATABASE_REQUIRED = process.env.DATABASE_REQUIRED === 'true';
if (AUTH_REQUIRED && !AUTH_ENABLED) {
  throw new Error('AUTH_REQUIRED needs GOOGLE_CLIENT_ID and a SESSION_SECRET of at least 32 characters');
}
if (DATABASE_REQUIRED && !database.enabled) {
  throw new Error('DATABASE_REQUIRED needs a Supabase DATABASE_URL');
}
if (database.enabled && !AUTH_ENABLED) {
  throw new Error('DATABASE_URL requires Google authentication so stored data always has a verified owner');
}
const WORLD_COLS = 44;
const WORLD_ROWS = 44;
const MAX_PHOTO_BYTES = 200000;
const configuredOrigins = new Set((process.env.ALLOWED_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean));
const googleClient = AUTH_ENABLED ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const sessionMiddleware = cookieSession({
  name: IS_PRODUCTION ? '__Host-study_desk_session' : 'study_desk_session',
  keys: AUTH_ENABLED ? [SESSION_SECRET] : ['development-only-session-key-not-used'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PRODUCTION,
});

// SECURITY: cross-origin Socket.IO handshakes were unrestricted. Accept same-origin
// browser traffic plus explicitly configured origins; production rejects originless clients.
function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return !IS_PRODUCTION;
  if (configuredOrigins.has(origin)) return true;
  try {
    const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    return new URL(origin).host === forwardedHost;
  } catch {
    return false;
  }
}

const connectionAttempts = new Map();
const authAttempts = new Map();
const actionAttempts = new Map();
const requestIp = (request) => request.headers['fly-client-ip'] || request.socket.remoteAddress || 'unknown';
function allowConnection(request, done) {
  if (!isAllowedOrigin(request)) return done('origin not allowed', false);
  const ip = requestIp(request);
  const now = Date.now();
  const recent = (connectionAttempts.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 30) return done('too many connection attempts', false);
  recent.push(now);
  connectionAttempts.set(ip, recent);
  return done(null, true);
}

function allowAuth(request) {
  const ip = requestIp(request);
  const now = Date.now();
  const recent = (authAttempts.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 10) return false;
  recent.push(now);
  authAttempts.set(ip, recent);
  return true;
}

function limitAction(action, limit, windowMs) {
  return (req, res, next) => {
    const actor = req.session?.user?.sub || requestIp(req);
    const key = `${action}:${actor}`;
    const now = Date.now();
    const recent = (actionAttempts.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) return res.status(429).json({ error: 'Too many requests; try again shortly' });
    recent.push(now);
    actionAttempts.set(key, recent);
    return next();
  };
}

const io = new Server(server, {
  // SECURITY: bounded payloads and connection attempts prevent oversized profile and handshake floods.
  maxHttpBufferSize: 220000,
  allowRequest: allowConnection,
});
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  // SECURITY: the browser profile is display data, not identity. Production sockets
  // are admitted only when the signed server session contains a verified Google account.
  if (AUTH_ENABLED && !socket.request.session?.user?.sub) return next(new Error('authentication required'));
  return next();
});

const players = new Map();
const occupiedChairs = new Map();
const chatBubbles = new Map();
const playerBubble = new Map();
const blockedTiles = new Set();
const validRoomId = (value) => /^[a-z0-9-]{6,48}$/.test(value) ? value : null;
const publicUserId = (subject) => crypto.createHmac('sha256', SESSION_SECRET).update(subject).digest('hex').slice(0, 24);
const chairKey = (roomId, chairId) => `${roomId}:${chairId}`;
const CHAT_DISTANCE = 4;
const roomPlayers = (roomId) => [...players.values()].filter((player) => player.roomId === roomId);
const isOccupied = (roomId, c, r, exceptId) => roomPlayers(roomId)
  .some((player) => player.id !== exceptId && player.c === c && player.r === r);
const canChat = (first, second) => first && second && first.id !== second.id
  && first.roomId === second.roomId
  && Math.max(Math.abs(first.c - second.c), Math.abs(first.r - second.r)) <= CHAT_DISTANCE;
const roomBubbleStates = (roomId) => [...chatBubbles.values()]
  .filter((bubble) => bubble.roomId === roomId)
  .map((bubble) => ({ id: bubble.id, locked: bubble.locked, memberIds: [...bubble.members] }));

function broadcastBubbles(roomId) {
  io.to(roomId).emit('chat:bubbles', roomBubbleStates(roomId));
}

function leaveBubble(playerId) {
  const bubbleId = playerBubble.get(playerId);
  const bubble = bubbleId && chatBubbles.get(bubbleId);
  playerBubble.delete(playerId);
  if (!bubble) return;
  bubble.members.delete(playerId);
  if (bubble.members.size < 2) {
    for (const memberId of bubble.members) playerBubble.delete(memberId);
    chatBubbles.delete(bubble.id);
  }
  broadcastBubbles(bubble.roomId);
}

function checkBubbleRange(playerId) {
  const bubbleId = playerBubble.get(playerId);
  const bubble = bubbleId && chatBubbles.get(bubbleId);
  if (!bubble) return;
  // Re-check every member when anyone moves. In a three-person chain, moving the
  // middle student can otherwise leave a distant member incorrectly inside the bubble.
  const isolated = [...bubble.members].filter((memberId) => ![...bubble.members]
    .some((otherId) => otherId !== memberId && canChat(players.get(memberId), players.get(otherId))));
  if (!isolated.length) return;
  for (const memberId of isolated) {
    bubble.members.delete(memberId);
    playerBubble.delete(memberId);
  }
  if (bubble.members.size < 2) {
    for (const memberId of bubble.members) playerBubble.delete(memberId);
    chatBubbles.delete(bubble.id);
  }
  broadcastBubbles(bubble.roomId);
}

const mapChairs = [
  { c: 15, r: 10, facing: 'down' }, { c: 18, r: 10, facing: 'down' },
  { c: 15, r: 15, facing: 'up' }, { c: 18, r: 15, facing: 'up' },
  { c: 7, r: 16, facing: 'down' }, { c: 10, r: 16, facing: 'down' },
  { c: 7, r: 21, facing: 'up' }, { c: 10, r: 21, facing: 'up' },
];
const firstFloorChairs = [
  ...[7, 10, 14, 17].map((c) => ({ c, r: 6, facing: 'down' })),
  ...[7, 10, 14, 17].map((c) => ({ c, r: 11, facing: 'up' })),
  { c: 13, r: 15, facing: 'down' },
  ...[29, 32, 36, 39].map((c) => ({ c, r: 13, facing: 'down' })),
  ...[29, 32, 36, 39].map((c) => ({ c, r: 18, facing: 'up' })),
];
const chairs = [
  ...[0, 22].flatMap((offset) => mapChairs.map((chair) => ({ ...chair, c: chair.c + offset, r: chair.r + 22 }))),
  ...firstFloorChairs,
];
const chairById = new Map(chairs.map((chair, index) => [`chair-${index}`, chair]));

function addMapCollision(file, offsets, collisionLayers) {
  const map = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  for (const { c: offC, r: offR } of offsets) {
    for (const layer of map.layers.filter((item) => collisionLayers.includes(item.name))) {
      layer.data.forEach((gid, index) => {
        if (gid) blockedTiles.add(`${offC + index % map.width},${offR + Math.floor(index / map.width)}`);
      });
    }
  }
}

addMapCollision('assets/maps/First Floor.tmj', [{ c: 0, r: 0 }], ['Shelves', 'Chairs', 'Table', 'Props']);
addMapCollision('assets/maps/library.tmj', [{ c: 0, r: 22 }, { c: 22, r: 22 }], ['Furniture', 'Table', 'Tile Layer 5', 'Tile Layer 7']);
for (const offC of [0, 22]) {
  for (const c of [1, 2, 3]) for (let r = 10; r <= 21; r += 1) if (r !== 17) blockedTiles.delete(`${offC + c},${22 + r}`);
  for (const r of [1, 2, 3, 4, 5, 6, 7]) for (let c = 0; c < 22; c += 1) {
    if (![1, 2, 3].includes(c)) blockedTiles.add(`${offC + c},${22 + r}`);
  }
}

function findSpawn(roomId) {
  for (let radius = 0; radius < WORLD_COLS; radius += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) for (let dr = -radius; dr <= radius; dr += 1) {
      const c = 11 + dc, r = 33 + dr;
      if (c >= 0 && r >= 0 && c < WORLD_COLS && r < WORLD_ROWS
        && !blockedTiles.has(`${c},${r}`) && !isOccupied(roomId, c, r)) return { c, r };
    }
  }
  return null;
}

function safeText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  // SECURITY: strip control characters and normalize untrusted display text before broadcasting it.
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim().slice(0, maxLength) || fallback;
}

function safePhoto(value, fallback = null) {
  if (typeof value !== 'string' || value.length > MAX_PHOTO_BYTES) return fallback;
  // SECURITY: SVG and arbitrary URL schemes are forbidden; only bounded raster data URLs are accepted.
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value) ? value : fallback;
}

function publicProfile(row) {
  if (!row) return null;
  return {
    name: row.name,
    avatar: row.avatar,
    color: row.color,
    photo: row.photo,
    complete: Boolean(row.profile_complete),
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAccount(req, res, next) {
  if (!AUTH_ENABLED || !req.session?.user?.sub) return res.status(401).json({ error: 'Sign in required' });
  return next();
}

function requireDatabase(_req, res, next) {
  if (!database.enabled) return res.status(503).json({ error: 'Persistent libraries are not configured' });
  return next();
}

const requireCompleteProfile = asyncRoute(async (req, res, next) => {
  const profile = await database.getProfile(req.session.user.sub);
  if (!profile?.profile_complete) return res.status(403).json({ error: 'Complete your profile first' });
  req.accountProfile = profile;
  return next();
});

function safeTile(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < WORLD_COLS ? number : null;
}

function allowEvent(socket, key, limit, windowMs = 1000) {
  const now = Date.now();
  socket.data.rates ||= new Map();
  const recent = (socket.data.rates.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  socket.data.rates.set(key, recent);
  return true;
}

setInterval(() => {
  // SECURITY: discard stale per-IP limiter state so spoofed/rotating addresses cannot grow memory forever.
  const cutoff = Date.now() - 60000;
  for (const [ip, times] of connectionAttempts) {
    const recent = times.filter((time) => time >= cutoff);
    if (recent.length) connectionAttempts.set(ip, recent);
    else connectionAttempts.delete(ip);
  }
  for (const [ip, times] of authAttempts) {
    const recent = times.filter((time) => time >= cutoff);
    if (recent.length) authAttempts.set(ip, recent);
    else authAttempts.delete(ip);
  }
  const actionCutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, times] of actionAttempts) {
    const recent = times.filter((time) => time >= actionCutoff);
    if (recent.length) actionAttempts.set(key, recent);
    else actionAttempts.delete(key);
  }
}, 60000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  // SECURITY: the app previously had no browser hardening headers. CSP permits only its
  // own files and the pinned Phaser CDN resource required by the existing no-build client.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", 'https://accounts.google.com/gsi/style'],
      // Phaser and profile previews set element.style at runtime; allow style attributes without allowing inline scripts.
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://accounts.google.com/gsi/'],
      frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  strictTransportSecurity: IS_PRODUCTION ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(sessionMiddleware);
app.use('/api/auth', express.json({ limit: '8kb', strict: true }));
app.use('/api/libraries', express.json({ limit: '8kb', strict: true }));
app.use('/api/study-sessions', express.json({ limit: '8kb', strict: true }));
app.use('/api/profile', express.json({ limit: '220kb', strict: true }));

app.use((req, res, next) => {
  // SECURITY: Fly terminates TLS; reject accidental plaintext production requests without breaking health checks.
  // fly.toml performs the public redirect, while this guard avoids reflecting an untrusted Host header.
  if (IS_PRODUCTION && req.path !== '/health' && !req.secure) return res.status(400).type('text').send('HTTPS required');
  return next();
});

app.get('/health', (_req, res) => res.status(200).json({ ok: true, database: database.enabled }));
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  let sessionUser = AUTH_ENABLED ? req.session?.user : null;
  // A session issued before Supabase was enabled has no durable user row. Require
  // one fresh Google sign-in instead of creating a half-owned profile or library.
  if (sessionUser && database.enabled && !await database.getProfile(sessionUser.sub)) {
    req.session = null;
    sessionUser = null;
  }
  res.json({
    enabled: AUTH_ENABLED,
    databaseEnabled: database.enabled,
    clientId: AUTH_ENABLED ? GOOGLE_CLIENT_ID : null,
    user: sessionUser ? {
      id: publicUserId(sessionUser.sub),
      name: sessionUser.name,
    } : null,
  });
}));
app.post('/api/auth/google', async (req, res) => {
  if (!AUTH_ENABLED) return res.status(404).json({ error: 'Authentication is not configured' });
  if (!allowAuth(req)) return res.status(429).json({ error: 'Too many sign-in attempts' });
  const credential = typeof req.body?.credential === 'string' && req.body.credential.length <= 10000
    ? req.body.credential : '';
  if (!credential) return res.status(400).json({ error: 'Google credential is required' });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error('unverified Google account');
  } catch {
    return res.status(401).json({ error: 'Google sign-in could not be verified' });
  }
  const name = safeText(payload.name, 'Student', 64);
  if (database.enabled) {
    try {
      await database.ensureUser({ subject: payload.sub, email: payload.email, name });
    } catch {
      console.error('[database] Google account could not be saved');
      return res.status(503).json({ error: 'Account storage is temporarily unavailable' });
    }
  }
  // SECURITY: the raw Google credential, email, and access tokens never enter the
  // signed browser session. The database is the only durable owner of the email.
  req.session.user = { sub: payload.sub, name };
  return res.json({ user: { id: publicUserId(payload.sub), name } });
});
app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.status(204).end();
});

app.get('/api/profile', requireAccount, requireDatabase, asyncRoute(async (req, res) => {
  const profile = await database.getProfile(req.session.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  return res.json({ profile: publicProfile(profile) });
}));

app.put('/api/profile', requireAccount, requireDatabase,
  limitAction('update-profile', 20, 60 * 1000), asyncRoute(async (req, res) => {
    const profile = {
      name: safeText(req.body?.name, 'Student', 64),
      avatar: req.body?.avatar === 'girl' ? 'girl' : 'male',
      color: /^#[0-9a-f]{6}$/i.test(req.body?.color) ? req.body.color : '#86efac',
      photo: safePhoto(req.body?.photo),
    };
    const saved = await database.updateProfile(req.session.user.sub, profile);
    if (!saved) return res.status(404).json({ error: 'Profile not found' });
    req.session.user.name = saved.name;
    return res.json({ profile: publicProfile(saved) });
  }));

app.get('/api/libraries', requireAccount, requireDatabase, requireCompleteProfile, asyncRoute(async (req, res) => {
  res.json({ libraries: await database.listLibraries(req.session.user.sub) });
}));

app.post('/api/libraries', requireAccount, requireDatabase,
  limitAction('create-library', 5, 60 * 60 * 1000), requireCompleteProfile, asyncRoute(async (req, res) => {
    const name = safeText(req.body?.name, `${req.session.user.name}'s Library`, 80);
    const library = await database.createLibrary(req.session.user.sub, name);
    res.status(201).json({ library });
  }));

app.post('/api/libraries/join', requireAccount, requireDatabase,
  limitAction('join-library', 30, 60 * 1000), requireCompleteProfile, asyncRoute(async (req, res) => {
    const inviteToken = validRoomId(String(req.body?.inviteToken || '').toLowerCase());
    if (!inviteToken) return res.status(400).json({ error: 'Enter a valid invite link' });
    const library = await database.joinLibrary(req.session.user.sub, inviteToken);
    if (!library) return res.status(404).json({ error: 'This invite link is invalid or expired' });
    return res.json({ library });
  }));

app.post('/api/study-sessions', requireAccount, requireDatabase,
  limitAction('study-session', 30, 60 * 1000), requireCompleteProfile, asyncRoute(async (req, res) => {
    const inviteToken = validRoomId(String(req.body?.roomId || '').toLowerCase());
    const mode = req.body?.mode === 'pomodoro' ? 'pomodoro' : 'focus';
    const topic = safeText(req.body?.topic, '', 120);
    if (!inviteToken) return res.status(400).json({ error: 'Library is required' });
    const studySession = await database.startStudySession(req.session.user.sub, inviteToken, mode, topic);
    if (!studySession) return res.status(403).json({ error: 'Library membership required' });
    return res.status(201).json({ studySession });
  }));

app.post('/api/study-sessions/:sessionId/finish', requireAccount, requireDatabase,
  limitAction('finish-study-session', 60, 60 * 1000), requireCompleteProfile, asyncRoute(async (req, res) => {
    const focusSeconds = Math.min(86400, Math.max(0, Math.round(Number(req.body?.focusSeconds) || 0)));
    const studySession = await database.finishStudySession(
      req.session.user.sub,
      String(req.params.sessionId),
      req.body?.completed === true,
      focusSeconds,
    );
    if (!studySession) return res.status(404).json({ error: 'Active study session not found' });
    return res.json({ studySession });
  }));
app.use(express.static(path.join(__dirname, 'client'), { dotfiles: 'deny', index: 'index.html' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', fallthrough: false }));
app.get('/room/:roomId', (req, res, next) => {
  // SECURITY: reject malformed resource identifiers rather than silently mapping them to a shared lobby.
  if (!validRoomId(String(req.params.roomId).toLowerCase())) return res.status(404).type('text').send('Room not found');
  return res.sendFile(path.join(__dirname, 'client', 'index.html'), (error) => error ? next(error) : undefined);
});

io.on('connection', (socket) => {
  socket.on('player:join', async (input = {}) => {
    if (!allowEvent(socket, 'join', 5, 60000) || players.has(socket.id) || socket.data.joining
      || !input || typeof input !== 'object') return;
    const roomId = validRoomId(String(input.roomId || '').toLowerCase());
    if (!roomId) return socket.disconnect(true);
    socket.data.joining = true;
    let storedProfile = null;
    if (database.enabled) {
      try {
        const subject = socket.request.session?.user?.sub;
        const [membership, accountProfile] = subject ? await Promise.all([
          database.membershipByInvite(subject, roomId),
          database.getProfile(subject),
        ]) : [];
        if (!membership || !accountProfile?.profile_complete) return socket.disconnect(true);
        storedProfile = publicProfile(accountProfile);
      } catch {
        console.error('[database] Socket membership check failed');
        return socket.disconnect(true);
      } finally {
        socket.data.joining = false;
      }
    }
    socket.join(roomId);
    const spawn = findSpawn(roomId);
    if (!spawn) return socket.disconnect(true);
    const { c, r } = spawn;
    const player = {
      id: socket.id,
      userId: socket.request.session?.user?.sub
        ? publicUserId(socket.request.session.user.sub)
        : socket.id,
      roomId,
      name: safeText(storedProfile?.name || input.name, 'Student', 24),
      avatar: (storedProfile?.avatar || input.avatar) === 'girl' ? 'girl' : 'male',
      color: storedProfile?.color || (/^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#86efac'),
      photo: storedProfile?.photo || safePhoto(input.photo),
      c, r, facing: 'down', moving: false, sitting: false, chairId: null,
      status: 'Active', topic: '', remainingSec: null,
    };
    players.set(socket.id, player);
    socket.emit('players:snapshot', roomPlayers(roomId));
    socket.emit('chat:bubbles', roomBubbleStates(roomId));
    socket.to(roomId).emit('player:joined', player);
  });

  socket.on('player:profile', (input = {}) => {
    const player = players.get(socket.id);
    if (!player || !allowEvent(socket, 'profile', 10, 60000) || !input || typeof input !== 'object') return;
    // SECURITY: profile ownership is derived from socket.id; clients cannot select another player record.
    player.name = safeText(input.name, player.name, 24);
    player.avatar = input.avatar === 'girl' ? 'girl' : 'male';
    player.color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : player.color;
    player.photo = safePhoto(input.photo, player.photo);
    io.to(player.roomId).emit('player:profile', player);
  });

  socket.on('player:move', (input = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    const c = safeTile(input?.c), r = safeTile(input?.r);
    const distance = player && c !== null && r !== null ? Math.abs(c - player.c) + Math.abs(r - player.r) : Infinity;
    // SECURITY: the server used to accept teleports and arbitrary coordinates. Only one-tile moves owned by this socket pass.
    if (!player || !allowEvent(socket, 'move', 30) || player.sitting || c === null || r === null || distance > 1
      || blockedTiles.has(`${c},${r}`) || isOccupied(player.roomId, c, r, socket.id)) {
      return reply({ ok: false, c: player?.c, r: player?.r });
    }
    player.c = c;
    player.r = r;
    if (['up', 'down', 'left', 'right'].includes(input.facing)) player.facing = input.facing;
    player.moving = Boolean(input.moving);
    if (['Active', 'Walking', 'Seated'].includes(player.status)) player.status = player.moving ? 'Walking' : 'Active';
    reply({ ok: true });
    checkBubbleRange(socket.id);
    // A stop packet between adjacent tiles made remote sprites flicker walk/idle.
    // Debounce only stops; the next walking packet cancels the brief false stop.
    clearTimeout(socket.data.stopTimer);
    if (player.moving) socket.to(player.roomId).emit('player:moved', player);
    else socket.data.stopTimer = setTimeout(() => {
      if (players.get(socket.id) === player && !player.moving) socket.to(player.roomId).emit('player:moved', player);
    }, 80);
  });

  socket.on('player:status', (input = {}) => {
    const player = players.get(socket.id);
    if (!player || !allowEvent(socket, 'status', 5) || !input || typeof input !== 'object') return;
    const allowed = ['Active', 'Walking', 'Seated', 'Focusing', 'Paused', 'On Break'];
    const requested = allowed.includes(input.status) ? input.status : player.status;
    // Fly restarts clear in-memory chairs. A reconnecting standing player must not
    // restore a locally running focus/break label until they sit again.
    player.status = !player.sitting && ['Focusing', 'On Break'].includes(requested) ? 'Paused' : requested;
    player.topic = safeText(input.topic, '', 60);
    const seconds = Number(input.remainingSec);
    player.remainingSec = Number.isFinite(seconds) ? Math.min(86400, Math.max(0, Math.round(seconds))) : null;
    io.to(player.roomId).emit('player:status', player);
  });

  socket.on('chat:enter', (_input = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    if (!player || !allowEvent(socket, 'chat-enter', 6, 10000)) return reply({ ok: false, error: 'Please wait' });
    const currentId = playerBubble.get(socket.id);
    if (currentId) return reply({ ok: true, bubble: chatBubbles.get(currentId) ? {
      id: currentId,
      locked: chatBubbles.get(currentId).locked,
      memberIds: [...chatBubbles.get(currentId).members],
    } : null });

    const nearby = roomPlayers(player.roomId)
      .filter((other) => canChat(player, other))
      .sort((first, second) => {
        const firstOpen = playerBubble.has(first.id) && !chatBubbles.get(playerBubble.get(first.id))?.locked;
        const secondOpen = playerBubble.has(second.id) && !chatBubbles.get(playerBubble.get(second.id))?.locked;
        return Number(secondOpen) - Number(firstOpen);
      });
    const target = nearby.find((other) => {
      const bubble = chatBubbles.get(playerBubble.get(other.id));
      return !bubble || !bubble.locked;
    });
    if (!target) return reply({ ok: false, error: 'Move near another student to chat' });

    let bubble = chatBubbles.get(playerBubble.get(target.id));
    if (!bubble) {
      bubble = { id: crypto.randomUUID(), roomId: player.roomId, members: new Set([target.id]), locked: false };
      chatBubbles.set(bubble.id, bubble);
      playerBubble.set(target.id, bubble.id);
    }
    bubble.members.add(socket.id);
    playerBubble.set(socket.id, bubble.id);
    broadcastBubbles(player.roomId);
    return reply({ ok: true, bubble: { id: bubble.id, locked: false, memberIds: [...bubble.members] } });
  });

  socket.on('chat:lock', (input = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    const bubble = chatBubbles.get(playerBubble.get(socket.id));
    if (!player || !bubble || !allowEvent(socket, 'chat-lock', 6, 10000)) {
      return reply({ ok: false, error: 'No active communication bubble' });
    }
    // SECURITY: only a current member can change admission to this server-owned bubble.
    bubble.locked = input?.locked !== false;
    broadcastBubbles(player.roomId);
    return reply({ ok: true, locked: bubble.locked });
  });

  socket.on('chat:leave', (_input = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    if (!player) return reply({ ok: false });
    leaveBubble(socket.id);
    return reply({ ok: true });
  });

  socket.on('chat:send', (input = {}, reply = () => {}) => {
    const sender = players.get(socket.id);
    const bubble = chatBubbles.get(playerBubble.get(socket.id));
    const text = safeText(input?.text, '', 500);
    // SECURITY: the server, not a recipient ID supplied by the browser, owns the
    // member list. Messages are relayed only to sockets currently inside this bubble.
    if (!sender || !bubble || !bubble.members.has(socket.id) || !text
      || !allowEvent(socket, 'chat', 8, 10000)) {
      return reply({ ok: false, error: 'Join a communication bubble first' });
    }
    const message = {
      id: crypto.randomUUID(), bubbleId: bubble.id, from: sender.id, text, sentAt: Date.now(),
    };
    for (const memberId of bubble.members) io.to(memberId).emit('chat:message', message);
    return reply({ ok: true });
  });

  socket.on('chair:sit', (input = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    const chairId = typeof input?.chairId === 'string' ? input.chairId : '';
    const chair = chairById.get(chairId);
    const key = player && chairKey(player.roomId, chairId);
    const nearby = player && chair && Math.abs(player.c - chair.c) <= 3 && Math.abs(player.r - chair.r) <= 4;
    // SECURITY: chair coordinates/facing are canonical server data; clients can no longer forge seats or lock fake IDs.
    if (!player || !allowEvent(socket, 'chair', 8) || !chair || !nearby
      || (occupiedChairs.has(key) && occupiedChairs.get(key) !== socket.id)) return reply({ ok: false });
    if (player.chairId) occupiedChairs.delete(chairKey(player.roomId, player.chairId));
    occupiedChairs.set(key, socket.id);
    Object.assign(player, { chairId, sitting: true, moving: false, c: chair.c, r: chair.r, facing: chair.facing });
    if (['Active', 'Walking', 'Seated'].includes(player.status)) player.status = 'Seated';
    reply({ ok: true });
    checkBubbleRange(socket.id);
    socket.to(player.roomId).emit('player:seated', player);
  });

  socket.on('chair:stand', (input = {}) => {
    const player = players.get(socket.id);
    if (!player || !allowEvent(socket, 'chair', 8)) return;
    if (player.chairId) occupiedChairs.delete(chairKey(player.roomId, player.chairId));
    const c = safeTile(input?.c), r = safeTile(input?.r);
    // SECURITY: standing coordinates are still client input; do not let them bypass walls or player collision.
    if (c !== null && r !== null && Math.abs(c - player.c) <= 4 && Math.abs(r - player.r) <= 4
      && !blockedTiles.has(`${c},${r}`) && !isOccupied(player.roomId, c, r, socket.id)) {
      player.c = c;
      player.r = r;
    }
    player.chairId = null;
    player.sitting = false;
    if (['up', 'down', 'left', 'right'].includes(input?.facing)) player.facing = input.facing;
    checkBubbleRange(socket.id);
    socket.to(player.roomId).emit('player:stood', player);
  });

  socket.on('disconnect', () => {
    clearTimeout(socket.data.stopTimer);
    const player = players.get(socket.id);
    if (!player) return;
    leaveBubble(socket.id);
    if (player.chairId) occupiedChairs.delete(chairKey(player.roomId, player.chairId));
    players.delete(socket.id);
    io.to(player.roomId).emit('player:left', socket.id);
  });
});

// SECURITY: unknown routes and failures return generic responses; internal paths and stacks stay server-side.
app.use((_req, res) => res.status(404).type('text').send('Not found'));
app.use((error, _req, res, _next) => {
  console.error('[server] request failed');
  if (!res.headersSent) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).type('text').send(status === 404 ? 'Not found' : 'Internal server error');
  }
});

server.listen(PORT, () => console.log(`Study Library listening on port ${PORT}`));

function shutdown(signal) {
  console.log(`[server] ${signal}; shutting down`);
  io.close(() => server.close(async () => {
    await database.close().catch(() => undefined);
    process.exit(0);
  }));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
