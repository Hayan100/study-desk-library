// Fly supports WebSockets directly. Using one persistent transport avoids a dropped
// long-polling session leaving the local player visible but unregistered.
const socket = window.io({ transports: ['websocket'], autoConnect: false });
const players = new Map();
let chatBubbles = [];
let scene = null;
let profile = null;
let databaseEnabled = false;
let selectedStudentId = null;
const pathRoom = location.pathname.match(/^\/room\/([a-z0-9-]{6,48})\/?$/i)?.[1]?.toLowerCase();
// The URL may contain an invite capability before authentication. It becomes the
// active Socket.IO room only after the server confirms this user's membership.
export let roomId = pathRoom || null;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

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
  if (selectedStudentId === id) selectedStudentId = null;
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
    const state = await api('/api/auth/me');
    databaseEnabled = state.databaseEnabled === true;
    return state;
  },
  async signInWithGoogle(accessToken) {
    const response = await fetch('/api/auth/google', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
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
  async profileState() {
    if (!databaseEnabled) return { profile: null };
    return api('/api/profile');
  },
  async saveProfile(nextProfile) {
    if (!databaseEnabled) return nextProfile;
    const result = await api('/api/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nextProfile),
    });
    return result.profile;
  },
  async libraries() {
    return databaseEnabled ? (await api('/api/libraries')).libraries : [];
  },
  async createLibrary(name) {
    return (await api('/api/libraries', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    })).library;
  },
  async joinLibrary(value) {
    let inviteToken = String(value || '').trim();
    try {
      inviteToken = new URL(inviteToken, location.origin).pathname.match(/^\/room\/([a-z0-9-]{6,48})\/?$/i)?.[1] || inviteToken;
    } catch { /* A raw token is also accepted. */ }
    return (await api('/api/libraries/join', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteToken }),
    })).library;
  },
  join(nextProfile, nextRoomId = roomId) {
    roomId = nextRoomId || `room-${crypto.randomUUID()}`;
    history.replaceState(null, '', `/room/${roomId}`);
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
  async updateProfile(nextProfile) {
    profile = { ...profile, ...nextProfile };
    profile = { ...profile, ...await this.saveProfile(profile) };
    localStorage.setItem('study-desk-profile', JSON.stringify(profile));
    scene?.setLocalAvatar(profile.avatar);
    socket.emit('player:profile', profile);
    return profile;
  },
  async startStudySession({ mode, topic }) {
    if (!databaseEnabled || !roomId) return null;
    return (await api('/api/study-sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId, mode, topic }),
    })).studySession;
  },
  async finishStudySession(sessionId, completed, focusSeconds) {
    if (!databaseEnabled || !sessionId) return null;
    return (await api(`/api/study-sessions/${encodeURIComponent(sessionId)}/finish`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completed, focusSeconds }),
    })).studySession;
  },
  async analytics() {
    return (await api('/api/analytics')).analytics;
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
  goToStudent(targetId, reply = () => {}) {
    socket.emit('player:travel', { targetId }, (response = {}) => {
      if (response.ok && response.player) {
        const self = players.get(socket.id);
        if (self) Object.assign(self, response.player);
        scene?.moveLocalPlayer(response.player);
        updateRoster();
        notifyPlayers();
      }
      reply(response);
    });
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

socket.on('connect', () => { if (profile && roomId) socket.emit('player:join', { ...profile, roomId }); });
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
    row.className = `person-row${nearby ? ' is-chat-ready' : ''}${player.id !== socket.id ? ' is-selectable' : ''}`;
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
    if (player.id !== socket.id) {
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', String(selectedStudentId === player.id));
      const select = () => { selectedStudentId = selectedStudentId === player.id ? null : player.id; updateRoster(); };
      row.addEventListener('click', select);
      row.addEventListener('keydown', (event) => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); select();
        }
      });
      if (selectedStudentId === player.id) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'person-action';
        action.textContent = 'Go to student';
        action.addEventListener('click', (event) => {
          event.stopPropagation();
          action.disabled = true;
          action.textContent = 'Going...';
          network.goToStudent(player.id, (response = {}) => {
            if (response.ok) { selectedStudentId = null; updateRoster(); return; }
            action.disabled = false;
            action.textContent = response.error || 'Could not go to student';
          });
        });
        row.append(action);
      }
    }
    return row;
  }));
  document.getElementById('online-count').textContent = players.size;
}

document.getElementById('people-search')?.addEventListener('input', updateRoster);
