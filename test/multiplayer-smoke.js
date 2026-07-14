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

function sit(ws, packetId, chairId = 'chair-0') {
  return new Promise((resolve) => {
    const handler = ({ data }) => {
      if (!data.startsWith(`43${packetId}`)) return;
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(data.slice(String(packetId).length + 2))[0]);
    };
    ws.addEventListener('message', handler);
    ws.send(`42${packetId}["chair:sit",{"chairId":"${chairId}","c":1,"r":1,"facing":"down"}]`);
  });
}

function move(ws, packetId, c, r) {
  return new Promise((resolve) => {
    const handler = ({ data }) => {
      if (!data.startsWith(`43${packetId}`)) return;
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(data.slice(String(packetId).length + 2))[0]);
    };
    ws.addEventListener('message', handler);
    ws.send(`42${packetId}["player:move",{"c":${c},"r":${r},"facing":"right","moving":true}]`);
  });
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
  console.log('multiplayer room isolation, movement, and chair lock smoke test passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
