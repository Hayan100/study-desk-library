// Session countdown. Timestamp-based (compares against an absolute end time), so it
// stays accurate even if the tab is throttled — not a naive per-tick decrement.
// In Pomodoro mode it auto-switches focus ⇄ break.

const hud = document.getElementById('timer-hud');
const phaseEl = document.getElementById('timer-phase');
const timeEl = document.getElementById('timer-time');
const topicEl = document.getElementById('timer-topic');
const toggleEl = document.getElementById('timer-toggle');

let intervalId = null;
let state = null; // { mode, phase, endTime, focusMs, breakMs, topic }
let pausedRemaining = null;
let lastSync = '';

export function startTimer(opts) {
  stopTimer();
  const now = Date.now();
  if (opts.mode === 'pomodoro') {
    state = {
      mode: 'pomodoro',
      phase: 'focus',
      topic: opts.topic,
      focusMs: opts.focusMin * 60000,
      breakMs: opts.breakMin * 60000,
      endTime: now + opts.focusMin * 60000,
    };
  } else {
    state = {
      mode: 'focus',
      phase: 'focus',
      topic: opts.topic,
      endTime: now + opts.durationMin * 60000,
    };
  }
  hud.hidden = false;
  setHudState('running');
  tick();
  intervalId = setInterval(tick, 250);
}

export function stopTimer() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  state = null;
  pausedRemaining = null;
  lastSync = '';
  hud.hidden = true;
  hud.classList.remove('is-running', 'is-paused', 'is-break', 'is-done');
}

export function pauseTimer() {
  if (!state || pausedRemaining !== null) return;
  pausedRemaining = Math.max(0, state.endTime - Date.now());
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  render(pausedRemaining);
  phaseEl.textContent = 'Paused';
  setHudState('paused');
}

export function resumeTimer() {
  if (!state || pausedRemaining === null) return;
  state.endTime = Date.now() + pausedRemaining;
  pausedRemaining = null;
  setHudState(state.phase === 'break' ? 'break' : 'running');
  tick();
  intervalId = setInterval(tick, 250);
}

function tick() {
  if (!state) return;
  const remaining = state.endTime - Date.now();

  if (remaining <= 0) {
    if (state.mode === 'pomodoro') {
      // Flip phase and start the next countdown from now.
      state.phase = state.phase === 'focus' ? 'break' : 'focus';
      const dur = state.phase === 'focus' ? state.focusMs : state.breakMs;
      state.endTime = Date.now() + dur;
      window.dispatchEvent(new CustomEvent('timer-phase-change', { detail: { phase: state.phase } }));
      // TODO(step2 – multiplayer): broadcast the phase switch so a shared timer stays in sync.
      render(dur);
      return;
    }
    // Focus mode: finished.
    render(0);
    clearInterval(intervalId);
    intervalId = null;
    phaseEl.textContent = 'Done';
    setHudState('done');
    window.dispatchEvent(new CustomEvent('timer-finished'));
    return;
  }
  render(remaining);
}

function render(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  timeEl.textContent = `${mm}:${ss}`;
  phaseEl.textContent = state.phase === 'break' ? 'Break' : 'Focus';
  topicEl.textContent = state.topic || '';
  if (pausedRemaining === null) setHudState(state.phase === 'break' ? 'break' : 'running');
  const status = state.phase === 'break' ? 'On Break' : pausedRemaining === null ? 'Focusing' : 'Paused';
  const sync = `${status}:${totalSec}:${state.topic || ''}`;
  if (sync !== lastSync) {
    lastSync = sync;
    window.dispatchEvent(new CustomEvent('timer-sync', {
      detail: { status, topic: state.topic || '', remainingSec: totalSec },
    }));
  }
}

function setHudState(value) {
  hud.classList.remove('is-running', 'is-paused', 'is-break', 'is-done');
  hud.classList.add(`is-${value}`);
  toggleEl.textContent = value === 'paused' ? 'Play' : 'Pause';
  toggleEl.disabled = value === 'done';
}
