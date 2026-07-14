import { network } from './network.js';

export function initJoinScreen() {
  const screen = document.getElementById('join-screen');
  const form = document.getElementById('join-form');
  const choices = [...form.querySelectorAll('.avatar-choice')];
  let avatar = 'male';

  const enter = (profile) => {
    network.join(profile);
    screen.hidden = true;
    document.getElementById('people-panel').hidden = false;
    document.getElementById('minimap-frame').hidden = false;
    document.body.classList.add('has-people-panel');
    window.dispatchEvent(new Event('resize'));
  };

  choices.forEach((button) => button.addEventListener('click', () => {
    avatar = button.dataset.avatar;
    choices.forEach((choice) => choice.classList.toggle('is-active', choice === button));
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('player-name').value.trim() || 'Student';
    enter({ name, avatar });
  });

  const saved = network.savedProfile();
  if (saved?.name && ['male', 'girl'].includes(saved.avatar)) {
    document.getElementById('player-name').value = saved.name;
    avatar = saved.avatar;
    choices.forEach((choice) => choice.classList.toggle('is-active', choice.dataset.avatar === avatar));
    enter(saved);
  }
}
