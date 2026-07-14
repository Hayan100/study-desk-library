// The local player: tile-based movement (24px grid) using the character_male sheet.
// This sheet has real 4-direction walk / idle / sit rows (181x181 frames), so no
// flipping is needed. Displayed at CHARACTER_SCALE to fit the 24px map.
const TILE = 24;
const STEP_MS = 150;
// 181px art fills its frame; ~0.22 makes the character ~1.6 tiles tall ("fits the map
// scale"). Bump toward 1.5 for a giant character — see CHANGE 2 notes.
const CHARACTER_SCALE = 0.44;
const WALK_SOUND = '/assets/audio/Walking%20Sound%20Effect/Roblox%20Walking%20Sound%20Effect.mp3';

const DIRS = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};
const IDLE_FRAME = { down: 16, up: 20, left: 24, right: 28 }; // first idle frame per dir

export class Player {
  constructor(scene, c, r) {
    this.scene = scene;
    this.c = c;
    this.r = r;
    this.facing = 'down';
    this.moving = false;
    this.sitting = false;
    this.standTile = null;
    this.path = [];
    this.pendingChair = null;
    this.avatar = 'male';
    this.walkAudio = new Audio(WALK_SOUND);
    this.walkAudio.loop = true;
    this.walkAudio.volume = 0.2;

    const { x, y } = this.tileToPixel(c, r);
    if (scene.textures.exists('male')) {
      this.sprite = scene.add.sprite(x, y, 'male', IDLE_FRAME.down).setOrigin(0.5, 1).setScale(CHARACTER_SCALE);
      this.seatedOverlay = scene.add.sprite(x, y, 'male', IDLE_FRAME.down)
        .setOrigin(0.5, 1).setScale(CHARACTER_SCALE).setVisible(false);
      this.hasAnims = true;
    } else {
      this.sprite = scene.add.rectangle(x, y, 16, 30, 0x6ca0dc).setOrigin(0.5, 1);
      this.seatedOverlay = null;
      this.hasAnims = false;
    }
    this.sprite.setDepth(1000); // above all map layers
  }

  tileToPixel(c, r) {
    return { x: c * TILE + TILE / 2, y: (r + 1) * TILE };
  }

  readDirKeys() {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return null;
    const { cursors, keys } = this.scene;
    if (cursors.left.isDown || keys.A.isDown) return 'left';
    if (cursors.right.isDown || keys.D.isDown) return 'right';
    if (cursors.up.isDown || keys.W.isDown) return 'up';
    if (cursors.down.isDown || keys.S.isDown) return 'down';
    return null;
  }

  // kind: 'walk' | 'idle' | 'sit'
  playDir(kind, dir) {
    if (!this.hasAnims) return;
    // The boy sheet contains distinct left- and right-facing rows.
    this.sprite.setFlipX(false);
    const key = `${this.avatar}-${kind}-${dir}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key, true);
    if (this.seatedOverlay?.visible && this.seatedOverlay.anims.currentAnim?.key !== key) {
      this.seatedOverlay.play(key, true);
    }
  }

  startStep(target, dir) {
    this.moving = true;
    this.facing = dir;
    this.playDir('walk', dir);
    if (this.walkAudio.paused) this.walkAudio.play().catch(() => {});
    this.scene.broadcastPlayer?.({ ...target, facing: dir, moving: true });
    const { x, y } = this.tileToPixel(target.c, target.r);
    this.scene.tweens.add({
      targets: this.sprite, x, y, duration: STEP_MS, ease: 'Linear',
      onComplete: () => {
        this.c = target.c; this.r = target.r; this.moving = false;
        this.scene.broadcastPlayer?.({ c: this.c, r: this.r, facing: this.facing, moving: false });
        if (!this.path.length && this.pendingChair) {
          const chair = this.pendingChair;
          this.pendingChair = null;
          this.sit(chair);
        }
        // TODO(step2 – multiplayer): broadcast new tile position.
      },
    });
  }

  setAvatar(avatar) {
    this.avatar = avatar === 'girl' ? 'girl' : 'male';
    this.sprite.setTexture(this.avatar);
    this.seatedOverlay?.setTexture(this.avatar);
    this.playDir(this.sitting ? 'sit' : 'idle', this.facing);
  }

  followPath(path, chair = null) {
    if (this.sitting) this.stand();
    this.path = path.slice();
    this.pendingChair = chair;
  }

  // Bug 3: E sits (correct direction row) / stands. If chair tiles are known, snap to a
  // nearby one; the current map has no chair markers, so we sit in place.
  toggleSit(chairs) {
    if (this.sitting) {
      this.stand();
      return;
    }
    if (this.moving) return;

    const target = this.findNearbyChair(chairs);
    if (!target) return;
    this.sit(target);
  }

  findNearbyChair(chairs = this.scene.chairs) {
    let best = null, bestD = 3; // accept the nearest chair within 2 tiles of its footprint
    for (const ch of chairs || []) {
      const dc = Math.max(ch.c - this.c, this.c - (ch.c + (ch.width || 1) - 1), 0);
      const dr = Math.max((ch.r - (ch.height || 1) + 1) - this.r, this.r - ch.r, 0);
      if (dc + dr < bestD) { bestD = dc + dr; best = ch; }
    }
    return best;
  }

  sit(target) {
    this.walkAudio.pause();
    this.standTile = { c: this.c, r: this.r };
    this.c = target.c; this.r = target.r;
    const seat = this.tileToPixel(this.c + ((target.width || 1) - 1) / 2, this.r);
    const x = seat.x + (target.seatOffsetX || 0);
    const y = seat.y;
    this.facing = target.facing;
    this.path = [];
    this.sitting = true;

    if (target.facing === 'up') {
      // Backward sit: the student is SOUTH of the table, so the whole sprite renders
      // in front of it (no crop). Nudged down 6px so head + body meet the table naturally.
      const seatY = y - TILE - 12;
      this.sprite.setPosition(x, seatY).setDepth(1000);
      if (this.seatedOverlay) this.seatedOverlay.setVisible(false).setCrop();
    } else {
      // Forward sit: the table (south) occludes the lower body; a head+shoulders overlay
      // renders above the tabletop while the full sprite sits behind it.
      const seatY = y - 12;
      this.sprite.setPosition(x, seatY).setDepth(2.5);
      if (this.seatedOverlay) {
        this.seatedOverlay.setPosition(x, seatY).setDepth(3.5).setVisible(true).setCrop(0, 0, 181, 105);
      }
    }
    this.playDir('sit', this.facing);
    const cam = this.scene.cameras.main;
    const screenX = cam.x + (this.sprite.x - cam.worldView.x) * cam.zoom;
    window.dispatchEvent(new CustomEvent('player-sat', {
      detail: { menuSide: screenX > this.scene.scale.width / 2 ? 'left' : 'right' },
    }));
    // TODO(step2 – multiplayer): broadcast sit state.
  }

  stand() {
    this.sitting = false;
    if (this.standTile) {
      this.c = this.standTile.c;
      this.r = this.standTile.r;
      const { x, y } = this.tileToPixel(this.c, this.r);
      this.sprite.setPosition(x, y);
      this.standTile = null;
    }
    this.sprite.setDepth(1000);
    if (this.seatedOverlay) {
      this.seatedOverlay.setVisible(false);
      this.seatedOverlay.setCrop();
    }
    this.playDir('idle', this.facing);
    window.dispatchEvent(new CustomEvent('player-stood'));
  }

  update() {
    if (this.moving) return;

    if (this.scene.inputLocked()) {          // Bug 1 + Bug 2
      this.walkAudio.pause();
      if (!this.sitting) this.playDir('idle', this.facing);
      return;
    }

    if (this.sitting) {
      if (!this.path.length && !this.readDirKeys()) return;
      this.stand();
    }

    if (this.path.length) {
      const next = this.path[0];
      const dir = this.dirTo(next);
      if (dir && this.scene.isWalkable(next.c, next.r)) { this.path.shift(); this.startStep(next, dir); }
      else this.path = [];
      return;
    }

    const dir = this.readDirKeys();
    if (dir) {
      const { dc, dr } = DIRS[dir];
      const target = { c: this.c + dc, r: this.r + dr };
      if (this.scene.isWalkable(target.c, target.r)) this.startStep(target, dir);
      else { this.walkAudio.pause(); this.facing = dir; this.playDir('idle', dir); }
    } else {
      this.walkAudio.pause();
      this.playDir('idle', this.facing);
    }
  }

  dirTo(tile) {
    const dc = tile.c - this.c, dr = tile.r - this.r;
    if (dc === 1 && dr === 0) return 'right';
    if (dc === -1 && dr === 0) return 'left';
    if (dc === 0 && dr === 1) return 'down';
    if (dc === 0 && dr === -1) return 'up';
    return null;
  }
}
