// Calm-music picker. Probes assets/audio, shows a chip per file that exists,
// plays one at a time on a loop with a volume control. Missing files are hidden.
// Playback only ever starts from a click (a user gesture) → browser autoplay-safe.

// Candidate tracks. assets/audio ships 1.mp3 … 9.mp3; probe reveals which exist.
const TRACKS = Array.from({ length: 9 }, (_, i) => ({
  file: `/assets/audio/${i + 1}.mp3`,
  label: `Calm ${i + 1}`,
}));

const audioEl = new Audio();
audioEl.loop = true;
let currentFile = null;
let currentChip = null;

export async function initAudio(container, volumeInput) {
  container.replaceChildren();
  audioEl.volume = parseFloat(volumeInput.value);
  volumeInput.addEventListener('input', () => {
    audioEl.volume = parseFloat(volumeInput.value);
  });

  let found = 0;
  for (const t of TRACKS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await exists(t.file))) continue; // hide missing options
    found += 1;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'audio-chip';
    chip.textContent = t.label;
    chip.addEventListener('click', () => toggleTrack(t.file, chip, container));
    container.appendChild(chip);
  }
  if (!found) {
    // SECURITY: keep all DOM rendering on textContent instead of retaining raw-HTML sinks.
    const empty = document.createElement('span'); empty.className = 'audio-empty';
    empty.textContent = 'No music found in assets/audio'; container.append(empty);
  }
}

function toggleTrack(file, chip, container) {
  // Clear "playing" highlight from all chips.
  container.querySelectorAll('.audio-chip').forEach((c) => c.classList.remove('is-playing'));

  // Clicking the currently-playing track stops it.
  if (currentFile === file && !audioEl.paused) {
    audioEl.pause();
    currentFile = null;
    currentChip = null;
    return;
  }
  if (currentFile !== file) {
    audioEl.src = file;
    currentFile = file;
  }
  audioEl.currentTime = 0;
  audioEl.play().catch((err) => console.warn('[audio] playback blocked:', err));
  chip.classList.add('is-playing');
  currentChip = chip;
  // TODO(step2 – Spotify): swap this local <audio> for shared Spotify Jam playback.
}

export function pauseAudio() {
  audioEl.pause();
}

export function resumeAudio() {
  if (currentFile) audioEl.play().catch((err) => console.warn('[audio] playback blocked:', err));
}

export function stopAudio() {
  audioEl.pause();
  audioEl.currentTime = 0;
  currentFile = null;
  currentChip?.classList.remove('is-playing');
  currentChip = null;
}

// Native two-tone chime: no network request or extra audio dependency at runtime.
export function playNotification() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  [660, 880].forEach((frequency, i) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.14;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  });
  setTimeout(() => ctx.close(), 500);
}

function exists(url) {
  return fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
}
