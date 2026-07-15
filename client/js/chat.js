import { network } from './network.js';
import { playNotification } from './audio.js';

// Keep the last 100 messages for the same room + participant set on this browser.
const threads = new Map();
const threadKey = (bubble) => {
  if (!bubble) return null;
  const memberIds = bubble.memberIds.map((id) => network.player(id)?.userId).filter(Boolean).sort();
  return memberIds.length === bubble.memberIds.length
    ? `${network.currentRoom()}:${memberIds.join(',')}`
    : `${network.currentRoom()}:${bubble.id}`;
};
const storedThread = (key) => {
  if (!key) return [];
  if (threads.has(key)) return threads.get(key);
  try {
    const parsed = JSON.parse(localStorage.getItem(`study-desk-chat:${key}`));
    const history = Array.isArray(parsed) ? parsed.filter((message) => message
      && typeof message.text === 'string' && message.text.length <= 500
      && typeof message.sentAt === 'number').slice(-100) : [];
    threads.set(key, history);
    return history;
  } catch {
    threads.set(key, []);
    return [];
  }
};
const saveThread = (key, history) => {
  threads.set(key, history);
  try { localStorage.setItem(`study-desk-chat:${key}`, JSON.stringify(history)); } catch { /* storage can be unavailable */ }
};
const isMine = (message) => message.fromUserId
  ? message.fromUserId === network.selfPlayer()?.userId
  : message.from === network.selfId();

export function initChat() {
  const panel = document.getElementById('chat-panel');
  const rail = document.getElementById('chat-rail');
  const peopleRail = document.getElementById('people-rail');
  const badge = document.getElementById('chat-unread');
  const avatar = document.getElementById('chat-avatar');
  const name = document.getElementById('chat-name');
  const presence = document.getElementById('chat-presence');
  const empty = document.getElementById('chat-empty');
  const messages = document.getElementById('chat-messages');
  const lock = document.getElementById('chat-lock');
  const leave = document.getElementById('chat-decline');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const send = form.querySelector('button');
  let visibleThreadKey = null;
  let unreadCount = 0;

  const showUnread = () => {
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.hidden = unreadCount === 0;
  };
  const clearUnread = () => { unreadCount = 0; showUnread(); };

  const current = () => network.currentBubble();
  const open = () => {
    document.body.classList.remove('sidebar-collapsed');
    document.getElementById('sidebar-toggle').title = 'Collapse sidebar';
    panel.hidden = false;
    rail.classList.add('is-active');
    peopleRail.classList.remove('is-active');
    clearUnread();
    const bubble = current();
    if (bubble) visibleThreadKey = threadKey(bubble);
    render();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  const close = () => {
    panel.hidden = true;
    rail.classList.remove('is-active');
    peopleRail.classList.add('is-active');
  };

  const render = (notice = '') => {
    const bubble = current();
    const memberNames = bubble?.memberIds
      .filter((id) => id !== network.selfId())
      .map((id) => network.player(id)?.name)
      .filter(Boolean) || [];
    if (bubble) visibleThreadKey = threadKey(bubble);
    const history = storedThread(visibleThreadKey);
    const active = Boolean(bubble);

    avatar.textContent = bubble?.locked ? '🔒' : 'C';
    avatar.className = `person-avatar bubble-avatar${bubble?.locked ? ' is-locked' : ''}`;
    name.textContent = active ? (memberNames.join(', ') || 'Communication bubble') : 'Communication bubble';
    presence.textContent = notice || (bubble
      ? `${bubble.locked ? 'Locked' : 'Open'} · ${bubble.memberIds.length} people`
      : 'Move near someone to connect');
    presence.classList.toggle('is-far', !active);
    lock.hidden = !active;
    leave.hidden = !active;
    lock.textContent = bubble?.locked ? 'Unlock bubble' : 'Lock bubble';
    lock.classList.toggle('is-locked', Boolean(bubble?.locked));
    input.disabled = !active;
    send.disabled = !active;
    input.placeholder = active ? 'Write to this bubble' : 'Move near another student';

    messages.replaceChildren(...history.map((message) => {
      const row = document.createElement('div');
      row.className = `chat-message${isMine(message) ? ' is-mine' : ''}`;
      const sender = document.createElement('small');
      sender.textContent = isMine(message) ? 'You' : message.fromName || network.player(message.from)?.name || 'Student';
      const body = document.createElement('span');
      // User messages are rendered as text nodes, never interpreted as HTML.
      body.textContent = message.text;
      row.append(sender, body);
      return row;
    }));
    messages.hidden = history.length === 0;
    empty.hidden = history.length > 0;
    if (!empty.hidden) empty.textContent = active
      ? 'This bubble is ready. Recent history is kept on this browser.'
      : 'Walk near another student to automatically form a white communication bubble.';
    messages.scrollTop = messages.scrollHeight;
  };

  rail.addEventListener('click', () => panel.hidden ? open() : close());
  peopleRail.addEventListener('click', close);
  document.getElementById('chat-close').addEventListener('click', close);
  window.addEventListener('open-chat', open);
  window.addEventListener('players-updated', () => { if (!panel.hidden) render(); });
  window.addEventListener('chat-bubbles', () => {
    if (!current() && visibleThreadKey) {
      visibleThreadKey = null;
      if (!panel.hidden) { close(); return; }
    }
    if (!panel.hidden) render();
  });
  window.addEventListener('chat-notice', ({ detail }) => { open(); render(detail || 'Could not join a bubble'); });
  window.addEventListener('chat-message', ({ detail: message }) => {
    if (!message?.bubbleId || typeof message.text !== 'string') return;
    const key = threadKey(network.bubble(message.bubbleId)) || `${network.currentRoom()}:${message.bubbleId}`;
    const history = storedThread(key);
    history.push({
      id: message.id,
      from: message.from,
      fromUserId: message.fromUserId || network.player(message.from)?.userId,
      fromName: message.fromName || network.player(message.from)?.name || 'Student',
      text: message.text,
      sentAt: Number(message.sentAt) || Date.now(),
    });
    if (history.length > 100) history.shift();
    saveThread(key, history);
    const viewing = !panel.hidden && current()?.id === message.bubbleId;
    if (viewing) render();
    if (!isMine(message)) {
      playNotification();
      if (!viewing) { unreadCount += 1; showUnread(); }
    }
  });

  lock.addEventListener('click', () => {
    const bubble = current();
    if (!bubble) return;
    lock.disabled = true;
    network.setBubbleLocked(!bubble.locked, (response = {}) => {
      lock.disabled = false;
      if (!response.ok) render(response.error || 'Could not change bubble lock');
    });
  });
  leave.addEventListener('click', () => network.leaveBubble((response = {}) => {
    if (response.ok) close();
    else render(response.error || 'Could not leave the communication bubble');
  }));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !current()) return;
    send.disabled = true;
    network.sendChat(text, (response = {}) => {
      send.disabled = false;
      if (response.ok) input.value = '';
      else render(response.error || 'Message could not be sent');
    });
  });

  render();
}
