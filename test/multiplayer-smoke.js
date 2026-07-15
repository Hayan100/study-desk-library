const assert = require('assert');

function connect(name, roomId = 'test-room') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${process.env.PORT || 3000}/socket.io/?EIO=4&transport=websocket`);
    let ready = false;
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      else if (data.startsWith('40') && !ready) {
        ready = true;
        ws.send(`42["player:join",{"name":"${name}","avatar":"male","roomId":"${roomId}"}]`);
        resolve(ws);
      } else if (data === '2') ws.send('3');
    };
    ws.onerror = reject;
  });
}

function emitAck(ws, packetId, event, payload = {}) {
  return new Promise((resolve) => {
    const handler = ({ data }) => {
      if (!data.startsWith(`43${packetId}`)) return;
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

function nextEvent(ws, name) {
  return new Promise((resolve) => {
    const handler = ({ data }) => {
      if (!data.startsWith('42')) return;
      const packet = JSON.parse(data.slice(2));
      if (packet[0] !== name) return;
      ws.removeEventListener('message', handler);
      resolve(packet[1]);
    };
    ws.addEventListener('message', handler);
  });
}

(async () => {
  const first = await connect('First');
  const second = await connect('Second');
  const otherRoom = await connect('Other', 'other-room');
  assert.equal((await move(first, 9, 43, 43)).ok, false); // server rejects teleport attempts
  assert.equal((await move(second, 8, 11, 32)).ok, true);
  assert.equal((await move(second, 7, 12, 32)).ok, true);
  assert.equal((await move(first, 10, 12, 33)).ok, true);
  assert.equal((await move(second, 11, 12, 33)).ok, false);
  assert.equal((await move(otherRoom, 12, 12, 33)).ok, true);

  const firstOpenState = nextEvent(first, 'chat:bubbles');
  const secondOpenState = nextEvent(second, 'chat:bubbles');
  assert.equal((await emitAck(first, 20, 'chat:enter')).ok, true);
  assert.equal((await firstOpenState)[0].memberIds.length, 2);
  assert.equal((await secondOpenState)[0].locked, false);

  const lockedState = nextEvent(second, 'chat:bubbles');
  assert.equal((await emitAck(first, 21, 'chat:lock', { locked: true })).locked, true);
  assert.equal((await lockedState)[0].locked, true);
  const third = await connect('Third');
  assert.equal((await emitAck(third, 22, 'chat:enter')).ok, false); // locked bubbles reject nearby newcomers
  assert.equal((await emitAck(third, 23, 'chat:send', { text: 'blocked' })).ok, false);

  const unlockedState = nextEvent(third, 'chat:bubbles');
  assert.equal((await emitAck(first, 24, 'chat:lock', { locked: false })).locked, false);
  assert.equal((await unlockedState)[0].locked, false);
  const joinedState = nextEvent(first, 'chat:bubbles');
  assert.equal((await emitAck(third, 25, 'chat:enter')).ok, true);
  assert.equal((await joinedState)[0].memberIds.length, 3);
  const receivedMessage = nextEvent(second, 'chat:message');
  assert.equal((await emitAck(third, 26, 'chat:send', { text: 'hello bubble' })).ok, true);
  assert.equal((await receivedMessage).text, 'hello bubble');
  const leftState = nextEvent(first, 'chat:bubbles');
  assert.equal((await emitAck(third, 27, 'chat:leave')).ok, true);
  assert.equal((await leftState)[0].memberIds.length, 2);
  third.close();

  const standingStatus = nextEvent(first, 'player:status');
  second.send('42["player:status",{"status":"Focusing","topic":"test"}]');
  assert.equal((await standingStatus).status, 'Paused');
  assert.equal((await sit(first, 1)).ok, true);
  assert.equal((await sit(second, 2)).ok, false);
  assert.equal((await sit(otherRoom, 4)).ok, true);
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await sit(second, 3)).ok, true);
  second.close();
  otherRoom.close();
  console.log('multiplayer room isolation, movement, bubble chat, and chair lock smoke test passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
