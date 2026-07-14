import { network } from './network.js';

export function initJoinScreen() {
  const screen = document.getElementById('join-screen');
  const form = document.getElementById('join-form');
  const choices = [...form.querySelectorAll('.avatar-choice')];
  let avatar = 'male';
  let profile = null;
  const toggle = document.getElementById('sidebar-toggle');
  const card = document.getElementById('profile-card');
  const editor = document.getElementById('profile-modal');

  const refreshProfile = () => {
    const initial = (profile.name || 'Student')[0].toUpperCase();
    for (const id of ['profile-card-photo', 'profile-photo-preview']) {
      const photo = document.getElementById(id);
      photo.textContent = initial;
      photo.style.background = profile.color;
    }
    document.getElementById('profile-card-name').textContent = profile.name;
    document.getElementById('profile-avatar-preview').className = `avatar-preview is-${profile.avatar}`;
    document.querySelectorAll('#profile-avatars .avatar-choice').forEach((choice) =>
      choice.classList.toggle('is-active', choice.dataset.avatar === profile.avatar));
    document.querySelectorAll('#profile-colors button').forEach((choice) =>
      choice.classList.toggle('is-active', choice.dataset.color === profile.color));
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
  document.querySelectorAll('#profile-avatars .avatar-choice').forEach((choice) => choice.addEventListener('click', () => {
    profile.avatar = choice.dataset.avatar; refreshProfile();
  }));
  document.querySelectorAll('#profile-colors button').forEach((choice) => choice.addEventListener('click', () => {
    profile.color = choice.dataset.color; refreshProfile();
  }));
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
