const socket = window.io();
const players = new Map();
let scene = null;
let profile = null;

socket.on('players:snapshot', (list) => {
  players.clear();
  list.forEach((player) => players.set(player.id, player));
  scene?.syncRemotePlayers([...players.values()], socket.id);
  if (profile) scene?.setLocalAvatar(profile.avatar);
  updateRoster();
});
socket.on('player:joined', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
});
socket.on('player:moved', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
});
for (const event of ['player:seated', 'player:stood']) socket.on(event, (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
});
socket.on('player:left', (id) => {
  players.delete(id);
  scene?.removeRemotePlayer(id);
  updateRoster();
});

export const network = {
  join(nextProfile) {
    profile = nextProfile;
    socket.emit('player:join', profile);
  },
  move(state) { socket.emit('player:move', state); },
  sit(chair, reply) {
    socket.emit('chair:sit', {
      chairId: chair.id, c: chair.c, r: chair.r, facing: chair.facing,
    }, reply);
  },
  stand(state) { socket.emit('chair:stand', state); },
  attachScene(nextScene) {
    scene = nextScene;
    scene.syncRemotePlayers([...players.values()], socket.id);
    if (profile) scene.setLocalAvatar(profile.avatar);
  },
};

function updateRoster() {
  const list = document.getElementById('people-list');
  if (!list) return;
  const query = document.getElementById('people-search').value.trim().toLowerCase();
  const visible = [...players.values()].filter((player) => player.name.toLowerCase().includes(query));
  list.replaceChildren(...visible.map((player) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    const initial = document.createElement('span');
    initial.className = `person-avatar is-${player.avatar}`;
    initial.textContent = player.name[0].toUpperCase();
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = player.id === socket.id ? `${player.name} (You)` : player.name;
    const status = document.createElement('small');
    status.textContent = 'Active';
    info.append(name, status);
    row.append(initial, info);
    return row;
  }));
  document.getElementById('online-count').textContent = players.size;
}

document.getElementById('people-search')?.addEventListener('input', updateRoster);
