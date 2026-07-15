// Fly supports WebSockets directly. Using one persistent transport avoids a dropped
// long-polling session leaving the local player visible but unregistered.
const socket = window.io({ transports: ['websocket'], autoConnect: false });
const players = new Map();
let chatBubbles = [];
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
  notifyPlayers();
});
socket.on('player:joined', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
  notifyPlayers();
});
socket.on('player:moved', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
  notifyPlayers();
});
socket.on('player:status', (player) => {
  players.set(player.id, player);
  updateRoster();
  notifyPlayers();
});
socket.on('player:profile', (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
  notifyPlayers();
});
for (const event of ['player:seated', 'player:stood']) socket.on(event, (player) => {
  players.set(player.id, player);
  scene?.upsertRemotePlayer(player, socket.id);
  updateRoster();
  notifyPlayers();
});
socket.on('player:left', (id) => {
  players.delete(id);
  scene?.removeRemotePlayer(id);
  updateRoster();
  notifyPlayers();
});
socket.on('chat:message', (message) => {
  if (!message || typeof message !== 'object') return;
  window.dispatchEvent(new CustomEvent('chat-message', { detail: message }));
});
socket.on('chat:bubbles', (bubbles) => {
  chatBubbles = Array.isArray(bubbles) ? bubbles.filter((bubble) => bubble
    && typeof bubble.id === 'string' && Array.isArray(bubble.memberIds)) : [];
  scene?.setChatBubbles(chatBubbles, socket.id);
  window.dispatchEvent(new CustomEvent('chat-bubbles', { detail: chatBubbles }));
  updateRoster();
});

export const network = {
  async authState() {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not check sign-in status');
    return response.json();
  },
  async signInWithGoogle(credential) {
    const response = await fetch('/api/auth/google', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Google sign-in failed');
    return result.user;
  },
  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    localStorage.removeItem('study-desk-profile');
    socket.disconnect();
  },
  join(nextProfile) {
    profile = nextProfile;
    localStorage.setItem('study-desk-profile', JSON.stringify(profile));
    scene?.setLocalAvatar(profile.avatar);
    if (socket.connected) socket.emit('player:join', { ...profile, roomId });
    else socket.connect();
  },
  move(state, reply = () => {}) {
    socket.emit('player:move', state, (response = {}) => {
      const self = players.get(socket.id);
      if (response.ok && self) {
        Object.assign(self, state);
        updateRoster();
        notifyPlayers();
      }
      reply(response);
    });
  },
  status(state) { socket.emit('player:status', state); },
  updateProfile(nextProfile) {
    profile = { ...profile, ...nextProfile };
    localStorage.setItem('study-desk-profile', JSON.stringify(profile));
    scene?.setLocalAvatar(profile.avatar);
    socket.emit('player:profile', profile);
  },
  savedProfile(accountId = null) {
    try {
      const saved = JSON.parse(localStorage.getItem('study-desk-profile'));
      // SECURITY: localStorage is user-controlled, so only the expected profile shape is restored.
      if (!saved || typeof saved !== 'object' || typeof saved.name !== 'string'
        || (accountId && saved.accountId !== accountId)) return null;
      return {
        name: saved.name.slice(0, 24),
        avatar: saved.avatar === 'girl' ? 'girl' : 'male',
        color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : '#86efac',
        accountId: typeof saved.accountId === 'string' ? saved.accountId : null,
        photo: typeof saved.photo === 'string' && saved.photo.length < 200000
          && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(saved.photo) ? saved.photo : null,
      };
    } catch { return null; }
  },
  isOccupied(c, r) {
    return [...players.values()].some((player) => player.id !== socket.id && player.c === c && player.r === r);
  },
  selfId() { return socket.id; },
  player(id) { return players.get(id) || null; },
  isNearby(id) {
    const self = players.get(socket.id), other = players.get(id);
    return Boolean(self && other && self.id !== other.id
      && Math.max(Math.abs(self.c - other.c), Math.abs(self.r - other.r)) <= 4);
  },
  currentBubble() { return chatBubbles.find((bubble) => bubble.memberIds.includes(socket.id)) || null; },
  enterBubble(reply = () => {}) { socket.emit('chat:enter', {}, reply); },
  setBubbleLocked(locked, reply = () => {}) { socket.emit('chat:lock', { locked }, reply); },
  leaveBubble(reply = () => {}) { socket.emit('chat:leave', {}, reply); },
  sendChat(text, reply = () => {}) { socket.emit('chat:send', { text }, reply); },
  playerPositions() { return [...players.values()].map(({ id, c, r }) => ({ id, c, r, self: id === socket.id })); },
  sit(chair, reply) {
    socket.emit('chair:sit', {
      chairId: chair.id, c: chair.c, r: chair.r, facing: chair.facing,
    }, (response = {}) => {
      const self = players.get(socket.id);
      if (response.ok && self) {
        Object.assign(self, { c: chair.c, r: chair.r, facing: chair.facing, sitting: true, chairId: chair.id });
        updateRoster();
        notifyPlayers();
      }
      reply(response);
    });
  },
  stand(state) {
    const self = players.get(socket.id);
    if (self) {
      Object.assign(self, state, { sitting: false, chairId: null });
      updateRoster();
      notifyPlayers();
    }
    socket.emit('chair:stand', state);
  },
  attachScene(nextScene) {
    scene = nextScene;
    scene.syncRemotePlayers([...players.values()], socket.id);
    scene.setChatBubbles(chatBubbles, socket.id);
    if (profile) scene.setLocalAvatar(profile.avatar);
  },
};

socket.on('connect', () => { if (profile) socket.emit('player:join', { ...profile, roomId }); });
socket.on('connect_error', (error) => {
  window.dispatchEvent(new CustomEvent('network-error', { detail: error.message || 'Connection failed' }));
});
socket.on('disconnect', () => {
  chatBubbles = [];
  scene?.setChatBubbles([], null);
  window.dispatchEvent(new CustomEvent('chat-bubbles', { detail: [] }));
});

function notifyPlayers() {
  window.dispatchEvent(new CustomEvent('players-updated'));
}

function updateRoster() {
  const list = document.getElementById('people-list');
  if (!list) return;
  const query = document.getElementById('people-search').value.trim().toLowerCase();
  const visible = [...players.values()].filter((player) => player.name.toLowerCase().includes(query));
  list.replaceChildren(...visible.map((player) => {
    const nearby = player.id !== socket.id && network.isNearby(player.id);
    const row = document.createElement('div');
    row.className = `person-row${nearby ? ' is-chat-ready' : ''}`;
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
