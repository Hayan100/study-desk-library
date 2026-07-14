const socket = window.io();
const players = new Map();
let scene = null;
let profile = null;
const pathRoom = location.pathname.match(/^\/room\/([a-z0-9-]{6,48})\/?$/i)?.[1]?.toLowerCase();
// SECURITY: invite links are bearer access. A full random UUID replaces the old 32-bit suffix.
export const roomId = pathRoom || `room-${crypto.randomUUID()}`;
if (!pathRoom) history.replaceState(null, '', `/room/${roomId}`);

socket.on('players:snapshot', (list) => {
  if (!Array.isArray(list)) return;
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
  updateRoster();
});
socket.on('player:status', (player) => {
  players.set(player.id, player);
  updateRoster();
});
socket.on('player:profile', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
});
for (const event of ['player:seated', 'player:stood']) socket.on(event, (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
});
socket.on('player:left', (id) => {
  players.delete(id);
  scene?.removeRemotePlayer(id);
  updateRoster();
});

export const network = {
  join(nextProfile) {
    profile = nextProfile;
    localStorage.setItem('study-desk-profile', JSON.stringify(profile));
    socket.emit('player:join', { ...profile, roomId });
  },
  move(state, reply = () => {}) { socket.emit('player:move', state, reply); },
  status(state) { socket.emit('player:status', state); },
  updateProfile(nextProfile) {
    profile = { ...profile, ...nextProfile };
    localStorage.setItem('study-desk-profile', JSON.stringify(profile));
    scene?.setLocalAvatar(profile.avatar);
    socket.emit('player:profile', profile);
  },
  savedProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem('study-desk-profile'));
      // SECURITY: localStorage is user-controlled, so only the expected profile shape is restored.
      if (!saved || typeof saved !== 'object' || typeof saved.name !== 'string') return null;
      return {
        name: saved.name.slice(0, 24),
        avatar: saved.avatar === 'girl' ? 'girl' : 'male',
        color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : '#86efac',
        photo: typeof saved.photo === 'string' && saved.photo.length < 200000
          && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(saved.photo) ? saved.photo : null,
      };
    } catch { return null; }
  },
  isOccupied(c, r) {
    return [...players.values()].some((player) => player.id !== socket.id && player.c === c && player.r === r);
  },
  playerPositions() { return [...players.values()].map(({ id, c, r }) => ({ id, c, r, self: id === socket.id })); },
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

socket.on('connect', () => { if (profile) socket.emit('player:join', { ...profile, roomId }); });

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
    if (player.color) initial.style.background = player.color;
    if (player.photo) { initial.style.background = `url(${player.photo}) center/cover`; initial.textContent = ''; }
    else initial.textContent = player.name[0].toUpperCase();
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = player.id === socket.id ? `${player.name} (You)` : player.name;
    const status = document.createElement('small');
    const clock = Number.isFinite(player.remainingSec)
      ? ` · ${Math.floor(player.remainingSec / 60)}:${String(player.remainingSec % 60).padStart(2, '0')}` : '';
    status.textContent = `${player.status || 'Active'}${player.topic ? ` · ${player.topic}` : ''}${clock}`;
    info.append(name, status);
    row.append(initial, info);
    return row;
  }));
  document.getElementById('online-count').textContent = players.size;
}

document.getElementById('people-search')?.addEventListener('input', updateRoster);
