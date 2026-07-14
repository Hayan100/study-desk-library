const assert = require('assert');

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3000/socket.io/?EIO=4&transport=websocket');
    let ready = false;
    ws.onmessage = ({ data }) => {
      if (data.startsWith('0')) ws.send('40');
      else if (data.startsWith('40') && !ready) {
        ready = true;
        ws.send(`42["player:join",{"name":"${name}","avatar":"male"}]`);
        resolve(ws);
      } else if (data === '2') ws.send('3');
    };
    ws.onerror = reject;
  });
}

function sit(ws, packetId) {
  return new Promise((resolve) => {
    const handler = ({ data }) => {
      if (!data.startsWith(`43${packetId}`)) return;
      ws.removeEventListener('message', handler);
      resolve(JSON.parse(data.slice(String(packetId).length + 2))[0]);
    };
    ws.addEventListener('message', handler);
    ws.send(`42${packetId}["chair:sit",{"chairId":"chair-test","c":1,"r":1,"facing":"down"}]`);
  });
}

(async () => {
  const first = await connect('First');
  const second = await connect('Second');
  assert.equal((await sit(first, 1)).ok, true);
  assert.equal((await sit(second, 2)).ok, false);
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await sit(second, 3)).ok, true);
  second.close();
  console.log('multiplayer chair lock smoke test passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
