import { network } from './network.js';

// Chat is deliberately ephemeral: messages live only in this tab and disappear
// when it closes. The server relays them only to current communication-bubble members.
const threads = new Map();

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
  let visibleBubbleId = null;

  const current = () => network.currentBubble();
  const open = () => {
    document.body.classList.remove('sidebar-collapsed');
    document.getElementById('sidebar-toggle').title = 'Collapse sidebar';
    panel.hidden = false;
    rail.classList.add('is-active');
    peopleRail.classList.remove('is-active');
    badge.hidden = true;
    const bubble = current();
    if (bubble) visibleBubbleId = bubble.id;
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
    if (bubble) visibleBubbleId = bubble.id;
    const history = visibleBubbleId ? threads.get(visibleBubbleId) || [] : [];
    const active = Boolean(bubble);

    avatar.textContent = bubble?.locked ? '🔒' : 'C';
    avatar.className = `person-avatar bubble-avatar${bubble?.locked ? ' is-locked' : ''}`;
    name.textContent = active ? (memberNames.join(', ') || 'Communication bubble') : 'Communication bubble';
    presence.textContent = notice || (bubble
      ? `${bubble.locked ? 'Locked' : 'Open'} · ${bubble.memberIds.length} people`
      : 'Move near someone and press C');
    presence.classList.toggle('is-far', !active);
    lock.hidden = !active;
    leave.hidden = !active;
    lock.textContent = bubble?.locked ? 'Unlock bubble' : 'Lock bubble';
    lock.classList.toggle('is-locked', Boolean(bubble?.locked));
    input.disabled = !active;
    send.disabled = !active;
    input.placeholder = active ? 'Write to this bubble' : 'Press C near another student';

    messages.replaceChildren(...history.map((message) => {
      const row = document.createElement('div');
      row.className = `chat-message${message.from === network.selfId() ? ' is-mine' : ''}`;
      const sender = document.createElement('small');
      sender.textContent = message.from === network.selfId() ? 'You' : network.player(message.from)?.name || 'Student';
      const body = document.createElement('span');
      // User messages are rendered as text nodes, never interpreted as HTML.
      body.textContent = message.text;
      row.append(sender, body);
      return row;
    }));
    messages.hidden = history.length === 0;
    empty.hidden = history.length > 0;
    if (!empty.hidden) empty.textContent = active
      ? 'This bubble is ready. Messages are visible only to its current members.'
      : 'Walk near another student and press C to create or join a white communication bubble.';
    messages.scrollTop = messages.scrollHeight;
  };

  rail.addEventListener('click', () => panel.hidden ? open() : close());
  peopleRail.addEventListener('click', close);
  document.getElementById('chat-close').addEventListener('click', close);
  window.addEventListener('open-chat', open);
  window.addEventListener('players-updated', () => { if (!panel.hidden) render(); });
  window.addEventListener('chat-bubbles', () => { if (!panel.hidden) render(); });
  window.addEventListener('chat-notice', ({ detail }) => { open(); render(detail || 'Could not join a bubble'); });
  window.addEventListener('chat-message', ({ detail: message }) => {
    if (!message?.bubbleId || typeof message.text !== 'string') return;
    const history = threads.get(message.bubbleId) || [];
    history.push(message);
    if (history.length > 100) history.shift();
    threads.set(message.bubbleId, history);
    if (!panel.hidden && current()?.id === message.bubbleId) render();
    else badge.hidden = false;
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
  leave.addEventListener('click', () => network.leaveBubble(() => render('You left the communication bubble')));

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
