// Wires the Start Session popup: mode tabs, duration fields, topic, calm-music
// options, and the Start button (which kicks off the countdown).
import { pauseTimer, resumeTimer, startTimer, stopTimer } from './timer.js';
import { initAudio, pauseAudio, playNotification, resumeAudio, stopAudio } from './audio.js';

// Bug 2: shared flag read by the scene to block movement while the popup is open.
// The session menu is available only while the student is seated.
export const sessionState = { open: false };

export function initSession() {
  const modal = document.getElementById('session-modal');
  const openBtn = document.getElementById('open-session');
  const closeBtn = document.getElementById('modal-close');
  const tabs = modal.querySelectorAll('.tab');
  const focusFields = document.getElementById('focus-fields');
  const pomoFields = document.getElementById('pomodoro-fields');
  const startBtn = document.getElementById('start-session');
  const endBtn = document.getElementById('timer-end');
  const toggleBtn = document.getElementById('timer-toggle');
  const volume = document.getElementById('volume');

  let mode = 'focus';
  let seated = false;
  let running = false;
  let paused = false;

  // --- Mode tabs (Focus / Pomodoro) ---
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      mode = tab.dataset.mode;
      focusFields.hidden = mode !== 'focus';
      pomoFields.hidden = mode !== 'pomodoro';
    });
  });

  // --- Calm-music options ---
  initAudio(document.getElementById('audio-options'), volume);

  // --- Show/hide helpers ---
  const openModal = () => { modal.hidden = false; openBtn.hidden = true; sessionState.open = true; };
  const closeModal = () => { modal.hidden = true; openBtn.hidden = false; sessionState.open = false; };

  closeBtn.addEventListener('click', closeModal);
  openBtn.hidden = true;

  window.addEventListener('player-sat', (event) => {
    seated = true;
    modal.classList.toggle('is-left', event.detail?.menuSide === 'left');
    if (running) toggleBtn.disabled = false;
    else openModal();
  });
  window.addEventListener('player-stood', () => {
    seated = false;
    if (running) {
      pauseTimer();
      pauseAudio();
      paused = true;
      toggleBtn.disabled = true;
    }
    if (!modal.hidden) closeModal();
    openBtn.hidden = true;
  });

  // --- Start the session ---
  startBtn.addEventListener('click', () => {
    const topic = document.getElementById('topic').value.trim();
    if (mode === 'pomodoro') {
      startTimer({
        mode: 'pomodoro',
        focusMin: Number(document.getElementById('pomo-focus').value),
        breakMin: Number(document.getElementById('pomo-break').value),
        topic,
      });
    } else {
      startTimer({
        mode: 'focus',
        durationMin: Number(document.getElementById('focus-duration').value),
        topic,
      });
    }
    modal.hidden = true;
    openBtn.hidden = true; // running: HUD is shown instead; "End" brings the popup back
    sessionState.open = false; // Bug 2: allow movement while a session runs
    running = true;
    paused = false;
    toggleBtn.disabled = false;
    // TODO(step2 – multiplayer): broadcast session start so others can see/join it.
  });

  // --- End the running session ---
  endBtn.addEventListener('click', () => {
    stopTimer();
    stopAudio();
    running = false;
    if (seated) openModal();
    else openBtn.hidden = true;
  });

  toggleBtn.addEventListener('click', () => {
    if (!running || !seated) return;
    if (paused) {
      resumeTimer();
      resumeAudio();
    } else {
      pauseTimer();
      pauseAudio();
    }
    paused = !paused;
  });

  window.addEventListener('timer-phase-change', () => playNotification());
  window.addEventListener('timer-finished', () => {
    playNotification();
    stopAudio();
    running = false;
    paused = false;
  });
}
