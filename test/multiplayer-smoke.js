const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

const port = 3201;
const root = path.join(__dirname, '..');
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    AUTH_REQUIRED: 'false',
    DATABASE_REQUIRED: 'false',
    GOOGLE_CLIENT_ID: '',
    SESSION_SECRET: '',
    DATABASE_URL: '',
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
  throw new Error('multiplayer test server did not start');
}

function connect(name, roomId = 'test-room') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`);
    const timeout = setTimeout(() => reject(new Error(`${name} did not join`)), 3000);
    let joined = false;
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      else if (data.startsWith('40') && !joined) {
        joined = true;
        ws.socketId = JSON.parse(data.slice(2) || '{}').sid;
        ws.send(`42["player:join",${JSON.stringify({ name, avatar: 'male', roomId })}]`);
      } else if (data.startsWith('42')) {
        const [event, payload] = JSON.parse(data.slice(2));
        if (event === 'players:snapshot') {
          clearTimeout(timeout);
          ws.snapshot = payload;
          resolve(ws);
        }
      } else if (data === '2') ws.send('3');
    };
    ws.onerror = reject;
  });
}

function emitAck(ws, packetId, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 3000);
    const handler = ({ data }) => {
      if (!data.startsWith(`43${packetId}`)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(data.slice(String(packetId).length + 2))[0]);
    };
    ws.addEventListener('message', handler);
    ws.send(`42${packetId}${JSON.stringify([event, payload])}`);
  });
}

function sit(ws, packetId, chairId = 'chair-0') {
  return emitAck(ws, packetId, 'chair:sit', { chairId, c: 1, r: 1, facing: 'down' });
}

function move(ws, packetId, c, r) {
  return emitAck(ws, packetId, 'player:move', { c, r, facing: 'right', moving: true });
}

function nextEvent(ws, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} event timed out`)), 3000);
    const handler = ({ data }) => {
      if (!data.startsWith('42')) return;
      const packet = JSON.parse(data.slice(2));
      if (packet[0] !== name || !predicate(packet[1])) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(packet[1]);
    };
    ws.addEventListener('message', handler);
  });
}

async function walkAway(ws, start, others, firstPacketId) {
  let current = { c: start.c, r: start.r };
  let packetId = firstPacketId;
  for (let step = 0; step < 16; step += 1) {
    const farEnough = others.every((other) => Math.max(Math.abs(current.c - other.c), Math.abs(current.r - other.r)) > 4);
    if (farEnough) return current;
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dc, dr]) => ({ c: current.c + dc, r: current.r + dr }))
      .sort((a, b) => Math.min(...others.map((other) => Math.max(Math.abs(b.c - other.c), Math.abs(b.r - other.r))))
        - Math.min(...others.map((other) => Math.max(Math.abs(a.c - other.c), Math.abs(a.r - other.r)))));
    let moved = false;
    for (const option of options) {
      // eslint-disable-next-line no-await-in-loop
      const response = await move(ws, packetId++, option.c, option.r);
      if (!response.ok) continue;
      current = option;
      moved = true;
      break;
    }
    if (!moved) throw new Error('Could not find a walkable route away from the bubble');
  }
  throw new Error('Player did not leave bubble range');
}

(async () => {
  await waitForServer();
  const first = await connect('First');
  const automaticBubble = nextEvent(first, 'chat:bubbles', (states) => states.some((bubble) => bubble.memberIds.length === 2));
  const second = await connect('Second');
  assert.equal(second.snapshot.length, 2, 'roster snapshot includes both students');
  assert.equal((await automaticBubble)[0].memberIds.length, 2, 'nearby players automatically form a bubble');

  assert.equal((await move(first, 1, 43, 43)).ok, false, 'server rejects teleport attempts');
  assert.equal((await move(second, 2, 11, 32)).ok, true);
  assert.equal((await move(second, 3, 12, 32)).ok, true);
  assert.equal((await move(first, 4, 12, 33)).ok, true);
  assert.equal((await move(second, 5, 12, 33)).ok, false, 'occupied tiles stay unavailable');

  const travel = await emitAck(first, 6, 'player:travel', { targetId: second.socketId, c: 0, r: 0 });
  assert.equal(travel.ok, true);
  assert.ok(Math.max(Math.abs(travel.player.c - 12), Math.abs(travel.player.r - 32)) <= 4);
  assert.notDeepEqual([travel.player.c, travel.player.r], [12, 32], 'travel never lands on the target');
  const otherRoom = await connect('Other', 'other-room');
  assert.equal((await emitAck(otherRoom, 7, 'player:travel', { targetId: first.socketId })).ok, false,
    'travel cannot cross room authorization');

  const lockedState = nextEvent(second, 'chat:bubbles');
  assert.equal((await emitAck(first, 8, 'chat:lock', { locked: true })).locked, true);
  assert.equal((await lockedState)[0].locked, true);
  const third = await connect('Third');
  assert.equal((await emitAck(third, 9, 'chat:enter')).ok, false, 'locked bubbles reject nearby newcomers');
  assert.equal((await emitAck(third, 10, 'chat:send', { text: 'blocked' })).ok, false);

  const joinedState = nextEvent(first, 'chat:bubbles');
  assert.equal((await emitAck(first, 11, 'chat:lock', { locked: false })).locked, false);
  const joinedBubble = (await joinedState)[0];
  assert.equal(joinedBubble.locked, false);
  assert.equal(joinedBubble.memberIds.length, 3, 'unlocking admits nearby students automatically');
  const receivedMessage = nextEvent(second, 'chat:message');
  assert.equal((await emitAck(third, 12, 'chat:send', { text: 'hello bubble' })).ok, true);
  const chatMessage = await receivedMessage;
  assert.equal(chatMessage.text, 'hello bubble');
  assert.equal(chatMessage.fromName, 'Third');
  assert.equal(chatMessage.fromUserId, third.socketId);

  const leftState = nextEvent(first, 'chat:bubbles');
  const thirdStart = third.snapshot.find((player) => player.id === third.socketId);
  const firstPosition = { c: travel.player.c, r: travel.player.r };
  const secondPosition = { c: 12, r: 32 };
  await walkAway(third, thirdStart, [firstPosition, secondPosition], 20);
  assert.equal((await leftState)[0].memberIds.length, 2, 'moving away automatically leaves the bubble');

  const standingStatus = nextEvent(first, 'player:status');
  second.send('42["player:status",{"status":"Focusing","topic":"test"}]');
  assert.equal((await standingStatus).status, 'Paused');
  assert.equal((await sit(first, 50)).ok, true);
  assert.equal((await sit(second, 51)).ok, false);
  assert.equal((await move(otherRoom, 52, 12, 33)).ok, true);
  assert.equal((await sit(otherRoom, 53)).ok, true, 'chair ownership is isolated by room');
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await sit(second, 54)).ok, true);
  second.close();
  third.close();
  otherRoom.close();
  console.log('multiplayer roster, safe travel, automatic bubble chat, room isolation, and chair lock smoke test passed');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => child.kill());
