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
  socket.on('player:join', ({ name, avatar } = {}) => {
    if (players.has(socket.id)) return;
    const player = {
      id: socket.id,
      name: String(name || 'Student').trim().slice(0, 24) || 'Student',
      avatar: avatar === 'girl' ? 'girl' : 'male',
      c: 11, r: 33, facing: 'down', moving: false,
    };
    players.set(socket.id, player);
    socket.emit('players:snapshot', [...players.values()]);
    socket.broadcast.emit('player:joined', player);
  });

  socket.on('player:move', (next = {}) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (Number.isFinite(next.c)) player.c = next.c;
    if (Number.isFinite(next.r)) player.r = next.r;
    if (['up', 'down', 'left', 'right'].includes(next.facing)) player.facing = next.facing;
    player.moving = Boolean(next.moving);
    socket.broadcast.emit('player:moved', player);
  });

  socket.on('disconnect', () => {
    if (players.delete(socket.id)) io.emit('player:left', socket.id);
  });
});

server.listen(PORT, () => {
  console.log('\n  📚  Study Library is running');
  console.log(`      →  http://localhost:${PORT}\n`);
});
