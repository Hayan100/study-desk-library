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
  let pendingLibrary = null;
  const toggle = document.getElementById('sidebar-toggle');
  const card = document.getElementById('profile-card');
  const launcher = document.getElementById('profile-launcher');
  const analyticsButton = document.getElementById('profile-analytics');
  const analyticsModal = document.getElementById('analytics-modal');
  const editor = document.getElementById('profile-modal');
  const avatarEditor = document.getElementById('avatar-modal');
  const inviteModal = document.getElementById('invite-modal');
  const copyButton = document.getElementById('invite-copy');
  const inviteField = document.getElementById('invite-link');
  const inviteButton = document.getElementById('invite-open');
  const loadingScreen = document.getElementById('loading-screen');
  const loadingProgress = document.getElementById('loading-progress');
  const loadingProgressbar = document.getElementById('loading-progressbar');
  const loadingPercent = document.getElementById('loading-percent');
  const loadingStatus = document.getElementById('loading-status');
  const LOADING_DURATION = 1800;
  let loadingFrame = 0;
  let loadingStartedAt = 0;
  let loadingValue = 0;
  let loadingReady = false;
  let loadingMessage = '';
  const walkthrough = document.getElementById('walkthrough');
  const walkthroughSteps = [
    ['\u{1F44B}', 'Welcome to your library', 'Move with WASD or the arrow keys. You can also click an open floor tile.'],
    ['E', 'Take a study seat', 'Walk near a chair. When the subtitle says “Press E to sit,” press E. Press it again to stand.'],
    ['C', 'Talk to nearby students', 'Walk close to someone and press C when the white bubble appears. Click the map to return to movement.'],
    ['\u{1F4DA}', 'Use your sidebar', 'You are always listed first. See who is active, open chat, and manage your focus time here.'],
  ];
  let walkthroughIndex = 0;
  const walkthroughKey = () => `study-desk-walkthrough:${profile?.accountId || profile?.name || 'guest'}`;
  const finishWalkthrough = () => {
    walkthrough.hidden = true;
    document.body.classList.remove('profile-open');
    try { localStorage.setItem(walkthroughKey(), 'done'); } catch { /* storage can be unavailable */ }
  };
  const renderWalkthrough = () => {
    const [icon, title, copy] = walkthroughSteps[walkthroughIndex];
    document.getElementById('walkthrough-icon').textContent = icon;
    document.getElementById('walkthrough-title').textContent = title;
    document.getElementById('walkthrough-copy').textContent = copy;
    document.getElementById('walkthrough-count').textContent = `${walkthroughIndex + 1} of ${walkthroughSteps.length}`;
    document.getElementById('walkthrough-back').hidden = walkthroughIndex === 0;
    document.getElementById('walkthrough-next').textContent = walkthroughIndex === walkthroughSteps.length - 1 ? 'Start studying' : 'Next';
  };
  const showWalkthrough = () => {
    try { if (localStorage.getItem(walkthroughKey())) return; } catch { /* show the tour if storage is unavailable */ }
    walkthroughIndex = 0;
    renderWalkthrough();
    walkthrough.hidden = false;
    document.body.classList.add('profile-open');
    document.getElementById('walkthrough-next').focus();
  };
  document.getElementById('walkthrough-skip').addEventListener('click', finishWalkthrough);
  document.getElementById('walkthrough-back').addEventListener('click', () => {
    walkthroughIndex = Math.max(0, walkthroughIndex - 1);
    renderWalkthrough();
  });
  document.getElementById('walkthrough-next').addEventListener('click', () => {
    if (walkthroughIndex === walkthroughSteps.length - 1) { finishWalkthrough(); return; }
    walkthroughIndex += 1;
    renderWalkthrough();
  });
  const setLoading = (percent, status) => {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    loadingValue = value;
    loadingProgress.style.width = `${value}%`;
    loadingProgressbar.setAttribute('aria-valuenow', String(value));
    loadingPercent.textContent = `${value}%`;
    loadingStatus.textContent = status;
  };
  const animateLoading = (now) => {
    const maximum = loadingReady ? 100 : 92;
    const value = Math.min(maximum, ((now - loadingStartedAt) / LOADING_DURATION) * 100);
    setLoading(value, loadingReady ? 'Finishing library' : loadingMessage);
    if (loadingReady && value >= 100) {
      setLoading(100, 'Library ready');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        loadingScreen.classList.add('is-hidden');
        setTimeout(() => { loadingScreen.hidden = true; showWalkthrough(); }, 240);
      }));
      return;
    }
    loadingFrame = requestAnimationFrame(animateLoading);
  };
  const showLoading = (status = 'Entering the library') => {
    cancelAnimationFrame(loadingFrame);
    loadingScreen.hidden = false;
    loadingScreen.classList.remove('is-hidden');
    loadingReady = false;
    loadingMessage = status;
    setLoading(0, status);
    loadingStartedAt = performance.now();
    loadingFrame = requestAnimationFrame(animateLoading);
  };
  const cancelLoading = () => {
    cancelAnimationFrame(loadingFrame);
    loadingScreen.hidden = true;
    loadingScreen.classList.remove('is-hidden');
  };
  const waitForReady = (className, eventName) => document.body.classList.contains(className)
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener(eventName, resolve, { once: true }));
  const finishLoadingWhenReady = () => {
    Promise.all([
      waitForReady('game-ready', 'game-ready'),
      waitForReady('multiplayer-ready', 'multiplayer-ready'),
    ]).then(() => {
      if (loadingValue >= 92) loadingStartedAt = performance.now() - ((loadingValue / 100) * LOADING_DURATION);
      loadingReady = true;
    });
  };
  const refreshInvite = (inviteToken = roomId) => {
    inviteField.value = inviteToken ? new URL(`/room/${encodeURIComponent(inviteToken)}`, location.origin).href : '';
  };
  const openInvite = (inviteToken = roomId) => {
    refreshInvite(inviteToken);
    copyButton.textContent = 'Copy';
    inviteModal.hidden = false;
  };
  inviteButton.addEventListener('click', () => {
    if (databaseActive && !account?.isAdmin) return;
    openInvite();
  });
  document.getElementById('invite-close').addEventListener('click', () => { inviteModal.hidden = true; });
  copyButton.addEventListener('click', async () => {
    try {
      // Clipboard may be unavailable outside HTTPS, so select the readonly field as a safe manual fallback.
      await navigator.clipboard.writeText(inviteField.value);
      copyButton.textContent = 'Copied';
    } catch {
      inviteField.focus();
      inviteField.select();
      copyButton.textContent = 'Select & copy';
    }
  });

  const refreshProfile = () => {
    const initial = (profile.name || 'Student')[0].toUpperCase();
    for (const id of ['profile-card-photo', 'profile-photo-preview', 'profile-launcher-photo']) {
      const photo = document.getElementById(id);
      photo.textContent = profile.photo ? '' : initial;
      photo.style.background = profile.photo ? `url(${profile.photo}) center/cover` : profile.color;
    }
    document.getElementById('profile-card-name').textContent = profile.name;
    document.getElementById('profile-launcher-name').textContent = profile.name;
    analyticsButton.hidden = !(databaseActive && account);
    document.getElementById('profile-avatar-preview').className = `avatar-preview is-${profile.avatar}`;
    document.getElementById('avatar-stage-preview').className = `avatar-preview is-${profile.avatar}`;
    document.getElementById('avatar-stage-name').textContent = profile.name;
    document.querySelectorAll('#avatar-library .avatar-card').forEach((choice) =>
      choice.classList.toggle('is-active', choice.dataset.avatar === profile.avatar));
  };

  const enter = (nextProfile, library = null) => {
    showLoading('Loading map and students');
    nextProfile.color ||= '#86efac';
    profile = nextProfile;
    refreshProfile();
    network.join(nextProfile, library?.inviteToken || roomId);
    document.getElementById('library-name').textContent = library?.name || 'STUDY DESK';
    refreshInvite();
    inviteButton.hidden = databaseActive && !(account?.isAdmin && library?.role === 'admin');
    screen.hidden = true;
    document.getElementById('people-panel').hidden = false;
    document.body.classList.add('has-people-panel');
    window.dispatchEvent(new Event('resize'));
    finishLoadingWhenReady();
  };
  window.addEventListener('network-error', ({ detail }) => {
    if (loadingScreen.hidden) return;
    cancelLoading();
    screen.hidden = false;
    libraryStep.hidden = false;
    document.getElementById('people-panel').hidden = true;
    document.body.classList.remove('has-people-panel');
    document.getElementById('library-message').textContent = detail || 'The room could not be loaded.';
  });

  toggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });

  const openCard = () => { refreshProfile(); card.hidden = false; };
  const closeCard = () => { card.hidden = true; };
  window.addEventListener('open-profile', openCard);
  launcher.addEventListener('click', () => card.hidden ? openCard() : closeCard());
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

  const formatFocus = (seconds) => {
    const minutes = Math.round(Math.max(0, Number(seconds) || 0) / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  };
  const renderAnalytics = (analytics) => {
    document.getElementById('analytics-total').textContent = formatFocus(analytics.totalFocusSeconds);
    document.getElementById('analytics-today').textContent = formatFocus(analytics.todayFocusSeconds);
    document.getElementById('analytics-completed').textContent = String(analytics.completedSessionCount || 0);
    const streak = Number(analytics.currentStreak) || 0;
    document.getElementById('analytics-streak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;
    document.getElementById('analytics-week').replaceChildren(...analytics.lastSevenDays.map((day) => {
      const item = document.createElement('div'); item.className = 'analytics-day';
      const label = document.createElement('strong');
      label.textContent = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
      const value = document.createElement('small'); value.textContent = formatFocus(day.focusSeconds);
      item.append(label, value); return item;
    }));
    const recent = analytics.recentSessions.map((session) => {
      const item = document.createElement('article'); item.className = 'analytics-session';
      const title = document.createElement('strong'); title.textContent = session.topic || (session.mode === 'pomodoro' ? 'Pomodoro' : 'Focus session');
      const date = document.createElement('span'); date.textContent = new Date(session.startedAt).toLocaleString();
      const duration = document.createElement('strong'); duration.textContent = formatFocus(session.focusSeconds);
      item.append(title, date, duration); return item;
    });
    if (!recent.length) {
      const empty = document.createElement('p'); empty.className = 'analytics-empty';
      empty.textContent = 'No finished study sessions yet.'; recent.push(empty);
    }
    document.getElementById('analytics-recent').replaceChildren(...recent);
  };
  analyticsButton.addEventListener('click', async () => {
    closeCard();
    analyticsModal.hidden = false;
    document.body.classList.add('profile-open');
    const status = document.getElementById('analytics-status');
    const content = document.getElementById('analytics-content');
    status.hidden = false; status.textContent = 'Loading your sessions...'; content.hidden = true;
    try {
      renderAnalytics(await network.analytics());
      status.hidden = true; content.hidden = false;
    } catch (error) {
      status.textContent = error.message || 'Analytics could not be loaded';
    }
  });
  document.getElementById('analytics-close').addEventListener('click', () => {
    analyticsModal.hidden = true; document.body.classList.remove('profile-open');
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
  const chooseProfile = (library = null) => {
    pendingLibrary = library;
    document.getElementById('player-name').value = profile?.name || account?.name || '';
    avatar = ['male', 'girl'].includes(profile?.avatar) ? profile.avatar : 'male';
    choices.forEach((choice) => choice.classList.toggle('is-active', choice.dataset.avatar === avatar));
    document.getElementById('profile-message').textContent = '';
    authStep.hidden = true;
    libraryStep.hidden = true;
    form.hidden = false;
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('player-name').value.trim() || 'Student';
    profile = { ...profile, name, avatar, color: profile?.color || '#86efac', accountId: account?.id || null };
    if (!databaseActive) {
      form.hidden = true;
      enter(profile, pendingLibrary);
      return;
    }
    try {
      profile = { ...profile, ...await network.saveProfile(profile) };
      localStorage.setItem('study-desk-profile', JSON.stringify(profile));
      form.hidden = true;
      enter(profile, pendingLibrary);
    } catch (error) {
      document.getElementById('profile-message').textContent = error.message;
    }
  });

  const renderLibraries = (libraries) => {
    const wrap = document.getElementById('saved-libraries');
    const list = document.getElementById('saved-library-list');
    const owned = account?.isAdmin ? libraries : [];
    wrap.hidden = owned.length === 0;
    list.replaceChildren(...owned.map((library) => {
      const card = document.createElement('article'); card.className = 'saved-library-card';
      const summary = document.createElement('div'); summary.className = 'saved-library-summary';
      const name = document.createElement('strong'); name.textContent = library.name;
      const active = document.createElement('small');
      const activeCount = Math.max(0, Number(library.activeCount) || 0);
      active.textContent = `${activeCount} active`;
      summary.append(name, active);

      const actions = document.createElement('div'); actions.className = 'saved-library-actions';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'room-action'; open.textContent = 'Open';
      const invite = document.createElement('button'); invite.type = 'button'; invite.className = 'room-action'; invite.textContent = 'Invite';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'room-action is-danger'; remove.textContent = 'Delete';
      open.addEventListener('click', () => chooseProfile(library));
      invite.addEventListener('click', () => openInvite(library.inviteToken));
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete "${library.name}"? Everyone in this room will be disconnected.`)) return;
        remove.disabled = true;
        const message = document.getElementById('library-message');
        try {
          await network.deleteLibrary(library.id);
          renderLibraries(await network.libraries());
          message.textContent = 'Room deleted.';
        } catch (error) {
          remove.disabled = false;
          message.textContent = error.message;
        }
      });
      actions.append(open, invite, remove);
      card.append(summary, actions);
      return card;
    }));
  };

  const showLibraryStep = async () => {
    const isAdmin = account?.isAdmin === true;
    form.hidden = true;
    authStep.hidden = true;
    libraryStep.hidden = true;
    document.getElementById('library-step-title').textContent = isAdmin ? 'Manage study rooms' : 'Join a study room';
    document.getElementById('library-step-copy').textContent = isAdmin
      ? 'Create rooms, invite students, and see who is active.'
      : 'Paste the invite link shared by an admin.';
    document.getElementById('create-library-form').hidden = !isAdmin;
    document.getElementById('join-library-form').hidden = isAdmin;
    document.getElementById('library-name-input').value ||= `${profile.name}'s Room`;
    if (roomId && !isAdmin) {
      const message = document.getElementById('library-message');
      message.textContent = 'Joining invited room...';
      try {
        const library = await network.joinLibrary(roomId);
        chooseProfile(library);
      } catch (error) {
        libraryStep.hidden = false;
        message.textContent = error.message;
      }
      return;
    }
    libraryStep.hidden = false;
    renderLibraries(isAdmin ? await network.libraries() : []);
  };

  document.getElementById('create-library-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!account?.isAdmin) return;
    const message = document.getElementById('library-message');
    const input = document.getElementById('library-name-input');
    message.textContent = 'Creating room...';
    try {
      await network.createLibrary(input.value);
      renderLibraries(await network.libraries());
      input.value = '';
      message.textContent = 'Room created. Open it or copy its invite link below.';
    } catch (error) {
      message.textContent = error.message;
    }
  });

  document.getElementById('join-library-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('library-message');
    message.textContent = 'Joining room...';
    try {
      const library = await network.joinLibrary(document.getElementById('library-invite-input').value);
      chooseProfile(library);
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const showProfileStep = async (user = null) => {
    account = user;
    authStep.hidden = true;
    if (databaseActive && user) {
      const stored = (await network.profileState()).profile;
      const local = network.savedProfile(user.id);
      profile = {
        ...(local || {}), ...(stored || {}),
        name: stored?.name || local?.name || user.name || 'Student',
        avatar: stored?.avatar || local?.avatar || 'male',
        color: stored?.color || local?.color || '#86efac',
        accountId: user.id,
      };
      localStorage.setItem('study-desk-profile', JSON.stringify(profile));
      await showLibraryStep();
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
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      // Load Google's OAuth client only when authentication is configured, so
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
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: 'openid email profile',
      callback: async ({ access_token: accessToken, error }) => {
        if (error || !accessToken) {
          authMessage.textContent = 'Google sign-in was cancelled or could not be completed.';
          return;
        }
        authMessage.textContent = 'Signing in...';
        try {
          const user = await network.signInWithGoogle(accessToken);
          authMessage.textContent = '';
          await showProfileStep(user);
        } catch (error) {
          authMessage.textContent = error.message;
        }
      },
    });
    // SECURITY: this native button only requests a short-lived Google token;
    // the server independently validates it before creating a session.
    googleSignIn.disabled = false;
    googleSignIn.onclick = () => {
      authMessage.textContent = '';
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    };
  };

  start().catch((error) => {
    authStep.hidden = false;
    authMessage.textContent = error.message || 'Sign-in is temporarily unavailable';
  });
}
