// Minimal static server for the study-library client.
// Serves /client (the game) and /assets (shared art + audio) on a local port.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const players = new Map();
const occupiedChairs = new Map();
const isOccupied = (c, r, exceptId) => [...players.values()]
  .some((player) => player.id !== exceptId && player.c === c && player.r === r);

// The game client (index.html, css, js).
app.use(express.static(path.join(__dirname, 'client')));
// Shared assets live at the project root; expose them under /assets/*.
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---------------------------------------------------------------------------
// TODO(step2 – multiplayer): wrap `app` in an http.Server and attach Socket.io:
//
//   const http = require('http');
//   const server = http.createServer(app);
//   const { Server } = require('socket.io');
//   const io = new Server(server);
//   io.on('connection', (socket) => {
//     // join, position broadcast, sit broadcast, timer sync hooks go here.
//   });
//   server.listen(PORT, ...);   // listen on `server` instead of `app`
//
// Everything above stays the same; only the listen target changes.
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('player:join', ({ name, avatar, color } = {}) => {
    if (players.has(socket.id)) return;
    let c = 11, r = 33;
    while (isOccupied(c, r, socket.id)) c += 1;
    const player = {
      id: socket.id,
      name: String(name || 'Student').trim().slice(0, 24) || 'Student',
      avatar: avatar === 'girl' ? 'girl' : 'male',
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#86efac',
      c, r, facing: 'down', moving: false, status: 'Active', topic: '', remainingSec: null,
    };
    players.set(socket.id, player);
    socket.emit('players:snapshot', [...players.values()]);
    socket.broadcast.emit('player:joined', player);
  });

  socket.on('player:profile', (next = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    player.name = String(next.name || player.name).trim().slice(0, 24) || player.name;
    player.avatar = next.avatar === 'girl' ? 'girl' : 'male';
    player.color = /^#[0-9a-f]{6}$/i.test(next.color) ? next.color : player.color;
    io.emit('player:profile', player);
  });

  socket.on('player:move', (next = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    const c = Number(next.c), r = Number(next.r);
    if (!player || !Number.isInteger(c) || !Number.isInteger(r) || isOccupied(c, r, socket.id)) {
      reply({ ok: false });
      return;
    }
    player.c = c;
    player.r = r;
    if (['up', 'down', 'left', 'right'].includes(next.facing)) player.facing = next.facing;
    player.moving = Boolean(next.moving);
    if (['Active', 'Walking', 'Seated'].includes(player.status)) player.status = player.moving ? 'Walking' : 'Active';
    reply({ ok: true });
    socket.broadcast.emit('player:moved', player);
  });

  socket.on('player:status', (next = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    const allowed = ['Active', 'Walking', 'Seated', 'Focusing', 'Paused', 'On Break'];
    player.status = allowed.includes(next.status) ? next.status : player.status;
    player.topic = String(next.topic || '').slice(0, 60);
    player.remainingSec = Number.isFinite(next.remainingSec) ? Math.max(0, Math.round(next.remainingSec)) : null;
    io.emit('player:status', player);
  });

  socket.on('chair:sit', (next = {}, reply = () => {}) => {
    const player = players.get(socket.id);
    const chairId = String(next.chairId || '');
    if (!player || !chairId || (occupiedChairs.has(chairId) && occupiedChairs.get(chairId) !== socket.id)) {
      reply({ ok: false });
      return;
    }
    if (player.chairId) occupiedChairs.delete(player.chairId);
    occupiedChairs.set(chairId, socket.id);
    Object.assign(player, {
      chairId, sitting: true, moving: false,
      c: Number(next.c), r: Number(next.r),
      facing: ['up', 'down'].includes(next.facing) ? next.facing : 'down',
    });
    if (['Active', 'Walking', 'Seated'].includes(player.status)) player.status = 'Seated';
    reply({ ok: true });
    socket.broadcast.emit('player:seated', player);
  });

  socket.on('chair:stand', (next = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (player.chairId) occupiedChairs.delete(player.chairId);
    Object.assign(player, {
      chairId: null, sitting: false,
      c: Number.isFinite(next.c) ? next.c : player.c,
      r: Number.isFinite(next.r) ? next.r : player.r,
      facing: ['up', 'down', 'left', 'right'].includes(next.facing) ? next.facing : player.facing,
    });
    socket.broadcast.emit('player:stood', player);
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player?.chairId) occupiedChairs.delete(player.chairId);
    if (players.delete(socket.id)) io.emit('player:left', socket.id);
  });
});

server.listen(PORT, () => {
  console.log('\n  📚  Study Library is running');
  console.log(`      →  http://localhost:${PORT}\n`);
});
