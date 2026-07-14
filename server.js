'use strict';

const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WORLD_COLS = 44;
const WORLD_ROWS = 44;
const MAX_PHOTO_BYTES = 200000;
const configuredOrigins = new Set((process.env.ALLOWED_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean));

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
function allowConnection(request, done) {
  if (!isAllowedOrigin(request)) return done('origin not allowed', false);
  const ip = request.headers['fly-client-ip'] || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (connectionAttempts.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 30) return done('too many connection attempts', false);
  recent.push(now);
  connectionAttempts.set(ip, recent);
  return done(null, true);
}

const io = new Server(server, {
  // SECURITY: bounded payloads and connection attempts prevent oversized profile and handshake floods.
  maxHttpBufferSize: 220000,
  allowRequest: allowConnection,
});

const players = new Map();
const occupiedChairs = new Map();
const blockedTiles = new Set();
const validRoomId = (value) => /^[a-z0-9-]{6,48}$/.test(value) ? value : null;
const chairKey = (roomId, chairId) => `${roomId}:${chairId}`;
const roomPlayers = (roomId) => [...players.values()].filter((player) => player.roomId === roomId);
const isOccupied = (roomId, c, r, exceptId) => roomPlayers(roomId)
  .some((player) => player.id !== exceptId && player.c === c && player.r === r);

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
}, 60000).unref();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  // SECURITY: the app previously had no browser hardening headers. CSP permits only its
  // own files and the pinned Phaser CDN resource required by the existing no-build client.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'"],
      // Phaser and profile previews set element.style at runtime; allow style attributes without allowing inline scripts.
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: IS_PRODUCTION ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

app.use((req, res, next) => {
  // SECURITY: Fly terminates TLS; reject accidental plaintext production requests without breaking health checks.
  // fly.toml performs the public redirect, while this guard avoids reflecting an untrusted Host header.
  if (IS_PRODUCTION && req.path !== '/health' && !req.secure) return res.status(400).type('text').send('HTTPS required');
  return next();
});

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.use(express.static(path.join(__dirname, 'client'), { dotfiles: 'deny', index: 'index.html' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', fallthrough: false }));
app.get('/room/:roomId', (req, res, next) => {
  // SECURITY: reject malformed resource identifiers rather than silently mapping them to a shared lobby.
  if (!validRoomId(String(req.params.roomId).toLowerCase())) return res.status(404).type('text').send('Room not found');
  return res.sendFile(path.join(__dirname, 'client', 'index.html'), (error) => error ? next(error) : undefined);
});

io.on('connection', (socket) => {
  socket.on('player:join', (input = {}) => {
    if (!allowEvent(socket, 'join', 5, 60000) || players.has(socket.id) || !input || typeof input !== 'object') return;
    const roomId = validRoomId(String(input.roomId || '').toLowerCase());
    if (!roomId) return socket.disconnect(true);
    socket.join(roomId);
    const spawn = findSpawn(roomId);
    if (!spawn) return socket.disconnect(true);
    const { c, r } = spawn;
    const player = {
      id: socket.id,
      roomId,
      name: safeText(input.name, 'Student', 24),
      avatar: input.avatar === 'girl' ? 'girl' : 'male',
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#86efac',
      photo: safePhoto(input.photo),
      c, r, facing: 'down', moving: false, sitting: false, chairId: null,
      status: 'Active', topic: '', remainingSec: null,
    };
    players.set(socket.id, player);
    socket.emit('players:snapshot', roomPlayers(roomId));
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
    socket.to(player.roomId).emit('player:moved', player);
  });

  socket.on('player:status', (input = {}) => {
    const player = players.get(socket.id);
    if (!player || !allowEvent(socket, 'status', 5) || !input || typeof input !== 'object') return;
    const allowed = ['Active', 'Walking', 'Seated', 'Focusing', 'Paused', 'On Break'];
    player.status = allowed.includes(input.status) ? input.status : player.status;
    player.topic = safeText(input.topic, '', 60);
    const seconds = Number(input.remainingSec);
    player.remainingSec = Number.isFinite(seconds) ? Math.min(86400, Math.max(0, Math.round(seconds))) : null;
    io.to(player.roomId).emit('player:status', player);
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
    socket.to(player.roomId).emit('player:stood', player);
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (!player) return;
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
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
