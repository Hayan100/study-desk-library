import { network } from './network.js';

const AVATARS = [
  { id: 'male', name: 'Boy' },
  { id: 'girl', name: 'Girl' },
];

export function initJoinScreen() {
  const screen = document.getElementById('join-screen');
  const form = document.getElementById('join-form');
  const choices = [...form.querySelectorAll('.avatar-choice')];
  let avatar = 'male';
  let profile = null;
  const toggle = document.getElementById('sidebar-toggle');
  const card = document.getElementById('profile-card');
  const editor = document.getElementById('profile-modal');
  const avatarEditor = document.getElementById('avatar-modal');

  const refreshProfile = () => {
    const initial = (profile.name || 'Student')[0].toUpperCase();
    for (const id of ['profile-card-photo', 'profile-photo-preview']) {
      const photo = document.getElementById(id);
      photo.textContent = profile.photo ? '' : initial;
      photo.style.background = profile.photo ? `url(${profile.photo}) center/cover` : profile.color;
    }
    document.getElementById('profile-card-name').textContent = profile.name;
    document.getElementById('profile-avatar-preview').className = `avatar-preview is-${profile.avatar}`;
    document.getElementById('avatar-stage-preview').className = `avatar-preview is-${profile.avatar}`;
    document.getElementById('avatar-stage-name').textContent = profile.name;
    document.querySelectorAll('#avatar-library .avatar-card').forEach((choice) =>
      choice.classList.toggle('is-active', choice.dataset.avatar === profile.avatar));
  };

  const enter = (profile) => {
    profile.color ||= '#86efac';
    network.join(profile);
    screen.hidden = true;
    document.getElementById('people-panel').hidden = false;
    document.body.classList.add('has-people-panel');
    window.dispatchEvent(new Event('resize'));
  };

  toggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });

  const openCard = () => { refreshProfile(); card.hidden = false; };
  const closeCard = () => { card.hidden = true; };
  window.addEventListener('open-profile', openCard);
  document.getElementById('profile-card-close').addEventListener('click', closeCard);
  document.getElementById('profile-edit').addEventListener('click', () => {
    closeCard(); refreshProfile();
    document.getElementById('profile-name').value = profile.name;
    editor.hidden = false; document.body.classList.add('profile-open');
  });
  document.getElementById('profile-modal-close').addEventListener('click', () => {
    editor.hidden = true; document.body.classList.remove('profile-open');
  });
  const avatarLibrary = document.getElementById('avatar-library');
  AVATARS.forEach(({ id, name }) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'avatar-card'; button.dataset.avatar = id;
    button.innerHTML = `<span class="avatar-preview is-${id}"></span><strong>${name}</strong>`;
    button.addEventListener('click', () => { profile.avatar = id; refreshProfile(); });
    avatarLibrary.append(button);
  });
  document.getElementById('profile-avatar-edit').addEventListener('click', () => {
    editor.hidden = true; avatarEditor.hidden = false; refreshProfile();
  });
  const closeAvatarEditor = (keep) => {
    if (!keep) profile.avatar = avatarEditor.dataset.original;
    avatarEditor.hidden = true; editor.hidden = false; refreshProfile();
  };
  document.getElementById('profile-avatar-edit').addEventListener('click', () => { avatarEditor.dataset.original = profile.avatar; });
  document.getElementById('avatar-modal-close').addEventListener('click', () => closeAvatarEditor(false));
  document.getElementById('avatar-cancel').addEventListener('click', () => closeAvatarEditor(false));
  document.getElementById('avatar-done').addEventListener('click', () => closeAvatarEditor(true));

  const photoInput = document.getElementById('profile-photo-input');
  document.getElementById('profile-photo-edit').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 192;
      const scale = Math.max(192 / image.width, 192 / image.height);
      const w = image.width * scale, h = image.height * scale;
      canvas.getContext('2d').drawImage(image, (192 - w) / 2, (192 - h) / 2, w, h);
      profile.photo = canvas.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(image.src); refreshProfile();
    };
    image.src = URL.createObjectURL(file);
  });
  document.getElementById('profile-form').addEventListener('submit', (event) => {
    event.preventDefault();
    profile.name = document.getElementById('profile-name').value.trim() || 'Student';
    network.updateProfile(profile);
    refreshProfile();
    editor.hidden = true;
    document.body.classList.remove('profile-open');
  });

  choices.forEach((button) => button.addEventListener('click', () => {
    avatar = button.dataset.avatar;
    choices.forEach((choice) => choice.classList.toggle('is-active', choice === button));
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('player-name').value.trim() || 'Student';
    profile = { name, avatar, color: '#86efac' };
    enter(profile);
  });

  const saved = network.savedProfile();
  if (saved?.name && ['male', 'girl'].includes(saved.avatar)) {
    document.getElementById('player-name').value = saved.name;
    avatar = saved.avatar;
    choices.forEach((choice) => choice.classList.toggle('is-active', choice.dataset.avatar === avatar));
    profile = { color: '#86efac', ...saved };
    enter(profile);
  }
}
