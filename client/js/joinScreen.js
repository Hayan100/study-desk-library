import { network, roomId } from './network.js';

const AVATARS = [
  { id: 'male', name: 'Boy' },
  { id: 'girl', name: 'Girl' },
];

export function initJoinScreen() {
  const screen = document.getElementById('join-screen');
  const form = document.getElementById('join-form');
  const authStep = document.getElementById('auth-step');
  const authMessage = document.getElementById('auth-message');
  const choices = [...form.querySelectorAll('.avatar-choice')];
  let avatar = 'male';
  let profile = null;
  let account = null;
  const toggle = document.getElementById('sidebar-toggle');
  const card = document.getElementById('profile-card');
  const editor = document.getElementById('profile-modal');
  const avatarEditor = document.getElementById('avatar-modal');
  const inviteModal = document.getElementById('invite-modal');
  // SECURITY: build the share URL from the browser's canonical origin and an encoded room capability.
  // This keeps Fly deployments shareable while avoiding malformed paths from string concatenation.
  const inviteUrl = new URL(`/room/${encodeURIComponent(roomId)}`, location.origin).href;
  const copyButton = document.getElementById('invite-copy');
  document.getElementById('invite-link').value = inviteUrl;
  document.getElementById('invite-open').addEventListener('click', () => {
    copyButton.textContent = 'Copy';
    inviteModal.hidden = false;
  });
  document.getElementById('invite-close').addEventListener('click', () => { inviteModal.hidden = true; });
  copyButton.addEventListener('click', async () => {
    try {
      // Clipboard may be unavailable outside HTTPS, so select the readonly field as a safe manual fallback.
      await navigator.clipboard.writeText(inviteUrl);
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1600);
    } catch {
      const field = document.getElementById('invite-link');
      field.focus();
      field.select();
      copyButton.textContent = 'Select & copy';
    }
  });

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

  const enter = (nextProfile) => {
    nextProfile.color ||= '#86efac';
    profile = nextProfile;
    network.join(nextProfile);
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
  document.getElementById('profile-logout').addEventListener('click', async () => {
    await network.logout();
    window.google?.accounts?.id?.disableAutoSelect();
    location.reload();
  });
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
    // SECURITY: build DOM nodes directly so future avatar metadata cannot become an HTML injection sink.
    const preview = document.createElement('span'); preview.className = `avatar-preview is-${id}`;
    const label = document.createElement('strong'); label.textContent = name;
    button.append(preview, label);
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
    // SECURITY: reject unexpected and oversized local files before decoding; the server validates the encoded result again.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      photoInput.value = '';
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 192;
      const scale = Math.max(192 / image.width, 192 / image.height);
      const w = image.width * scale, h = image.height * scale;
      canvas.getContext('2d').drawImage(image, (192 - w) / 2, (192 - h) / 2, w, h);
      profile.photo = canvas.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(image.src); refreshProfile();
    };
    image.onerror = () => { URL.revokeObjectURL(image.src); photoInput.value = ''; };
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
    profile = { name, avatar, color: '#86efac', accountId: account?.id || null };
    enter(profile);
  });

  const showProfileStep = (user = null) => {
    account = user;
    authStep.hidden = true;
    const saved = network.savedProfile(user?.id || null);
    if (saved?.name && ['male', 'girl'].includes(saved.avatar)) {
      document.getElementById('player-name').value = saved.name;
      avatar = saved.avatar;
      choices.forEach((choice) => choice.classList.toggle('is-active', choice.dataset.avatar === avatar));
      enter({ color: '#86efac', ...saved, accountId: user?.id || saved.accountId || null });
      return;
    }
    document.getElementById('player-name').value = user?.name || '';
    form.hidden = false;
  };

  const waitForGoogle = () => {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      // Load Google's managed button only when authentication is configured, so
      // guest-mode development does not contact a third party unnecessarily.
      const script = document.createElement('script');
      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timeout = setTimeout(() => reject(new Error('Google sign-in did not load')), 10000);
      script.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      script.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Google sign-in did not load')); }, { once: true });
      document.head.append(script);
    });
  };

  const start = async () => {
    const state = await network.authState();
    if (!state.enabled || state.user) {
      showProfileStep(state.user);
      return;
    }
    authStep.hidden = false;
    await waitForGoogle();
    window.google.accounts.id.initialize({
      client_id: state.clientId,
      callback: async ({ credential }) => {
        authMessage.textContent = 'Signing in...';
        try {
          const user = await network.signInWithGoogle(credential);
          authMessage.textContent = '';
          showProfileStep(user);
        } catch (error) {
          authMessage.textContent = error.message;
        }
      },
    });
    window.google.accounts.id.renderButton(document.getElementById('google-signin'), {
      type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 330,
    });
  };

  start().catch((error) => {
    authStep.hidden = false;
    authMessage.textContent = error.message || 'Sign-in is temporarily unavailable';
  });
}
