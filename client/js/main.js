// Entry point: boots the Phaser game and wires up the HTML session popup.
import { LibraryScene } from './scene.js';
import { initSession } from './session.js';
import { initJoinScreen } from './joinScreen.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  pixelArt: true,            // no smoothing on scale-up
  roundPixels: true,
  backgroundColor: '#1a1420',
  scale: {
    mode: Phaser.Scale.RESIZE, // canvas fills the full browser window
    width: '100%',
    height: '100%',
  },
  scene: [LibraryScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

// The Start Session popup + timer are plain DOM, independent of Phaser.
initSession();
initJoinScreen();
