import { network, roomId } from './network.js';

const AVATARS = [
  { id: 'male', name: 'Boy' },
  { id: 'girl', name: 'Girl' },
];

export function initJoinScreen() {
  const screen = document.getElementById('join-screen');
  const form = document.getElementById('join-form');
  const libraryStep = document.getElementById('library-step');
  const authStep = document.getElementById('auth-step');
  const authMessage = document.getElementById('auth-message');
  document.getElementById('email-auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    // SECURITY: do not collect or transmit passwords until Supabase Auth is configured;
    // the app never stores credentials in its own profile database.
    document.getElementById('auth-password').value = '';
    authMessage.textContent = 'Email sign-in is coming next. Please continue securely with Google for now.';
  });
  const choices = [...form.querySelectorAll('.avatar-choice')];
  let avatar = 'male';
  let profile = null;
  let account = null;
  let databaseActive = false;
  const toggle = document.getElementById('sidebar-toggle');
  const card = document.getElementById('profile-card');
  const editor = document.getElementById('profile-modal');
  const avatarEditor = document.getElementById('avatar-modal');
  const inviteModal = document.getElementById('invite-modal');
  const copyButton = document.getElementById('invite-copy');
  const inviteField = document.getElementById('invite-link');
  const refreshInvite = () => {
    inviteField.value = roomId ? new URL(`/room/${encodeURIComponent(roomId)}`, location.origin).href : '';
  };
  document.getElementById('invite-open').addEventListener('click', () => {
    refreshInvite();
    copyButton.textContent = 'Copy';
    inviteModal.hidden = false;
  });
  document.getElementById('invite-close').addEventListener('click', () => { inviteModal.hidden = true; });
  copyButton.addEventListener('click', async () => {
    try {
      // Clipboard may be unavailable outside HTTPS, so select the readonly field as a safe manual fallback.
      await navigator.clipboard.writeText(inviteField.value);
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1600);
    } catch {
      inviteField.focus();
      inviteField.select();
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

  const enter = (nextProfile, library = null) => {
    nextProfile.color ||= '#86efac';
    profile = nextProfile;
    network.join(nextProfile, library?.inviteToken || roomId);
    document.getElementById('library-name').textContent = library?.name || 'STUDY DESK';
    refreshInvite();
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
  document.getElementById('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    profile.name = document.getElementById('profile-name').value.trim() || 'Student';
    try {
      profile = await network.updateProfile(profile);
    } catch {
      return;
    }
    refreshProfile();
    editor.hidden = true;
    document.body.classList.remove('profile-open');
  });

  choices.forEach((button) => button.addEventListener('click', () => {
    avatar = button.dataset.avatar;
    choices.forEach((choice) => choice.classList.toggle('is-active', choice === button));
  }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('player-name').value.trim() || 'Student';
    profile = { name, avatar, color: '#86efac', accountId: account?.id || null };
    if (!databaseActive) {
      enter(profile);
      return;
    }
    try {
      profile = { ...profile, ...await network.saveProfile(profile) };
      localStorage.setItem('study-desk-profile', JSON.stringify(profile));
      await showLibraryStep();
    } catch (error) {
      document.getElementById('profile-message').textContent = error.message;
    }
  });

  const renderLibraries = (libraries) => {
    const wrap = document.getElementById('saved-libraries');
    const list = document.getElementById('saved-library-list');
    wrap.hidden = libraries.length === 0;
    list.replaceChildren(...libraries.map((library) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'saved-library-button';
      const name = document.createElement('strong'); name.textContent = library.name;
      const role = document.createElement('small'); role.textContent = library.role;
      button.append(name, role);
      button.addEventListener('click', () => enter(profile, library));
      return button;
    }));
  };

  const showLibraryStep = async () => {
    form.hidden = true;
    authStep.hidden = true;
    libraryStep.hidden = false;
    document.getElementById('library-name-input').value ||= `${profile.name}'s Library`;
    const libraries = await network.libraries();
    renderLibraries(libraries);
    if (roomId) {
      const message = document.getElementById('library-message');
      message.textContent = 'Joining invited library...';
      try {
        const library = await network.joinLibrary(roomId);
        enter(profile, library);
      } catch (error) {
        message.textContent = error.message;
      }
    }
  };

  document.getElementById('create-library-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('library-message');
    message.textContent = 'Creating library...';
    try {
      const library = await network.createLibrary(document.getElementById('library-name-input').value);
      enter(profile, library);
    } catch (error) {
      message.textContent = error.message;
    }
  });

  document.getElementById('join-library-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('library-message');
    message.textContent = 'Joining library...';
    try {
      const library = await network.joinLibrary(document.getElementById('library-invite-input').value);
      enter(profile, library);
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const showProfileStep = async (user = null) => {
    account = user;
    authStep.hidden = true;
    if (databaseActive && user) {
      const stored = (await network.profileState()).profile;
      if (stored?.complete) {
        profile = { ...stored, accountId: user.id };
        localStorage.setItem('study-desk-profile', JSON.stringify(profile));
        await showLibraryStep();
        return;
      }
      const local = network.savedProfile(user.id);
      document.getElementById('player-name').value = local?.name || stored?.name || user.name || '';
      avatar = local?.avatar || stored?.avatar || 'male';
      choices.forEach((choice) => choice.classList.toggle('is-active', choice.dataset.avatar === avatar));
      form.hidden = false;
      return;
    }
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
    databaseActive = state.databaseEnabled === true;
    if (!state.enabled || state.user) {
      await showProfileStep(state.user);
      return;
    }
    authStep.hidden = false;
    await waitForGoogle();
    const googleSignIn = document.getElementById('google-signin');
    window.google.accounts.id.initialize({
      client_id: state.clientId,
      callback: async ({ credential }) => {
        authMessage.textContent = 'Signing in...';
        try {
          const user = await network.signInWithGoogle(credential);
          authMessage.textContent = '';
          await showProfileStep(user);
        } catch (error) {
          authMessage.textContent = error.message;
        }
      },
    });
    googleSignIn.disabled = false;
    googleSignIn.addEventListener('click', () => {
      authMessage.textContent = '';
      // SECURITY: Google Identity Services owns account selection and returns the credential for server validation.
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
          authMessage.textContent = 'Google sign-in could not open. Please try again.';
        }
      });
    });
  };

  start().catch((error) => {
    authStep.hidden = false;
    authMessage.textContent = error.message || 'Sign-in is temporarily unavailable';
  });
}
