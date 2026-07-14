// The library scene: loads the Tiled map (assets/maps/library.tmj) and its tileset,
// derives collision from the furniture/table layers, and owns the local Player.
import { Player } from './player.js';
import { sessionState } from './session.js';
import { network } from './network.js';

const TILE = 24;
// Tile the whole map horizontally this many times for a wider world
// (2 = original + one duplicate to the right). Set to 1 for the single room.
const MAP_COPIES = 2;

const A = {
  map: '/assets/maps/library.tmj',
  firstFloor: '/assets/maps/First%20Floor.tmj', // 44x22 second storey, stacked on top
  tiles: '/assets/tilesets/library.png',      // matches the tmj's embedded "../tilesets/library.png"
  girl: '/assets/characters/character_girl.png',
  male: '/assets/characters/character_male.png',
};

// --- Ground floor (library.tmj, 22x22, duplicated horizontally) ---
// Draw order — Floor first (bottom). Names match the .tmj exactly.
const LAYER_ORDER = ['Floor', 'Stairs', 'Furniture', 'Table', 'Tile Layer 5', 'Tile Layer 7'];
// Collision layers (Floor & Stairs are walkable).
const COLLISION_LAYERS = ['Furniture', 'Table', 'Tile Layer 5', 'Tile Layer 7'];
// The long red runners are painted on the Furniture layer but are floor decoration
// (cols 1-3, rows 10-16 & 18-21) — excluded from collision.
const CARPET_COLS = [1, 2, 3];

// --- First floor (First Floor.tmj, 44x22, single map) — its own layer names ---
const FF_LAYER_ORDER = ['Floor', 'Carpet', 'Shelves', 'Chairs', 'Table', 'Props'];
const FF_COLLISION_LAYERS = ['Shelves', 'Chairs', 'Table', 'Props']; // Floor & Carpet walkable

// First-floor chair anchors (read from First Floor.tmj Chairs/Table layers). 2-wide seats;
// chairs above a table face down, chairs below face up. World = local (first floor at 0,0).
// down-seats anchor on the table's TOP row (like the library) so the desk occludes the
// feet; up-seats anchor two rows below the table's bottom.
const FF_CHAIRS = [
  ...[7, 10, 14, 17].map((c) => ({ c, r: 6, facing: 'down' })),         // top-left table (rows 6-9)
  ...[7, 10, 14, 17].map((c) => ({ c, r: 11, facing: 'up' })),
  { c: 13, r: 15, facing: 'down' },                                      // bottom-left desk (rows 15-19)
  ...[29, 32, 36, 39].map((c) => ({ c, r: 13, facing: 'down' })),       // right table (rows 13-16)
  ...[29, 32, 36, 39].map((c) => ({ c, r: 18, facing: 'up' })),
].map((ch) => ({ ...ch, width: 2, height: 2 }));

// The library's top rows are the inter-floor wall (not climbable) except the stairs
// columns (the red carpet runner), which stay open so the player crosses floors there.
const WALL_ROWS = [1, 2, 3, 4, 5, 6, 7]; // railing + blue wall; row 0 is walkable floor
const STAIRS_COLS = [1, 2, 3];  // library-local columns kept open (the carpet stairway)

// Chair anchors in the supplied library.tmj. Each entry is the bottom-left tile
// of a 2x3 chair footprint. Keeping these explicit avoids relying on tileset GIDs,
// which Phaser can normalize differently while parsing Tiled maps.
const MAP_CHAIRS = [
  { c: 15, r: 10, facing: 'down' }, { c: 18, r: 10, facing: 'down' },
  { c: 15, r: 15, facing: 'up' }, { c: 18, r: 15, facing: 'up' },
  { c: 7, r: 16, facing: 'down' }, { c: 10, r: 16, facing: 'down' },
  { c: 7, r: 21, facing: 'up' }, { c: 10, r: 21, facing: 'up' },
].map((chair) => ({ ...chair, width: 2, height: 3 }));

export class LibraryScene extends Phaser.Scene {
  constructor() {
    super('LibraryScene');
    this.blocked = new Set();
    this.chairs = MAP_CHAIRS;
    this.remotePlayers = new Map();
  }

  preload() {
    this.load.on('loaderror', (file) => console.warn('[assets] expected but missing:', file.src));
    this.load.tilemapTiledJSON('library-map', A.map);
    this.load.tilemapTiledJSON('firstfloor-map', A.firstFloor);
    this.load.image('library-tiles', A.tiles);
    // Character sheets: 4 cols x 12 rows, each frame 181x181.
    this.load.spritesheet('girl', A.girl, { frameWidth: 181, frameHeight: 181 });
    this.load.spritesheet('male', A.male, { frameWidth: 181, frameHeight: 181 });
  }

  create() {
    const LIB_W = 22, FLOOR_H = 22; // library tile size; first floor is FLOOR_H tall
    this.cols = LIB_W * MAP_COPIES;   // 44 wide (library duplicated) — matches First Floor's 44
    this.rows = FLOOR_H + LIB_W;      // first floor (22) on top + library (22) below = 44
    this.worldW = this.cols * TILE;
    this.worldH = this.rows * TILE;
    this.libRow = FLOOR_H;            // library starts at this global row

    // The sit-behind-desk occlusion assumes the desk's Table layer sits at depth 3.
    // Library Table is layer index 3 (depthBase 0 -> depth 3); First Floor Table is
    // index 4, so its depthBase is -1 to also land at depth 3.
    this.placeMap('firstfloor-map', 0, 0, FF_LAYER_ORDER, FF_COLLISION_LAYERS, -1);

    // Ground floor (library) duplicated horizontally, below the first floor (rows 22..43).
    for (let copy = 0; copy < MAP_COPIES; copy++) {
      this.placeMap('library-map', copy * LIB_W, FLOOR_H, LAYER_ORDER, COLLISION_LAYERS, 0,
        { carpetCols: CARPET_COLS, wallRows: WALL_ROWS, stairsCols: STAIRS_COLS });
    }

    // Sit-chairs: library (offset to its world position) + first floor (at 0,0).
    this.chairs = [];
    for (let copy = 0; copy < MAP_COPIES; copy++) {
      for (const ch of MAP_CHAIRS) this.chairs.push({
        ...ch,
        c: ch.c + copy * LIB_W,
        r: ch.r + FLOOR_H,
        seatOffsetX: 0,
      });
    }
    for (const ch of FF_CHAIRS) this.chairs.push({ ...ch, seatOffsetX: 0 });
    this.chairs.forEach((chair, index) => { chair.id = `chair-${index}`; });

    this.createAnims();

    // Spawn in the ground-floor (left library) centre.
    const spawn = this.findOpenTile(Math.floor(LIB_W / 2), FLOOR_H + Math.floor(LIB_W / 2));
    this.player = new Player(this, spawn.c, spawn.r);
    network.attachScene(this);

    this.setupInput();
    this.setupCamera();
  }

  requestSit(chair) {
    network.sit(chair, ({ ok }) => {
      if (ok && !this.player.sitting) this.player.sit(chair);
      else if (!ok) window.dispatchEvent(new CustomEvent('chair-unavailable'));
    });
  }

  releaseChair(state) { network.stand(state); }

  // Render one Tiled map at a tile offset, with per-layer depth and collision.
  // opts.carpetCols: columns whose runner tiles (on a collision layer) stay walkable.
  placeMap(key, offCol, offRow, layerOrder, collisionLayers, depthBase, opts = {}) {
    const map = this.make.tilemap({ key });
    const tiles = map.addTilesetImage('library', 'library-tiles'); // name embedded in every .tmj
    const px = offCol * TILE, py = offRow * TILE;

    const layers = {};
    layerOrder.forEach((name, i) => {
      const layer = map.createLayer(name, tiles, px, py);
      if (layer) { layer.setDepth(depthBase + i); layers[name] = layer; }
      else console.warn('[map] layer not found:', name, 'in', key);
    });

    collisionLayers.forEach((name) => {
      const layer = layers[name];
      if (!layer) return;
      layer.setCollisionByExclusion([-1]);
      layer.forEachTile((t) => { if (t.index !== -1) this.blocked.add(`${t.x + offCol},${t.y + offRow}`); });
    });
    // Runner tiles painted on a collision layer are decorative floor — keep walkable.
    if (opts.carpetCols) {
      for (const c of opts.carpetCols) for (let r = 10; r <= 21; r++) {
        if (r !== 17) this.blocked.delete(`${c + offCol},${r + offRow}`);
      }
    }
    // Solid inter-floor wall: block the wall-band rows except the stairs columns.
    if (opts.wallRows) {
      for (const r of opts.wallRows) for (let c = 0; c < map.width; c++) {
        if (!opts.stairsCols.includes(c)) this.blocked.add(`${c + offCol},${r + offRow}`);
      }
    }
  }

  createAnims() {
    if (!this.textures.exists('girl')) { console.warn('[assets] girl sheet missing'); return; }
    const mk = (sheet, key, frames, rate) =>
      this.anims.create({ key: `${sheet}-${key}`, frames: this.anims.generateFrameNumbers(sheet, { frames }), frameRate: rate, repeat: -1 });
    // 4 columns per row → row r spans frames [r*4 .. r*4+3].
    for (const sheet of ['male', 'girl']) {
      mk(sheet, 'walk-down', [0, 1, 2, 3], 8);
      mk(sheet, 'walk-up', [4, 5, 6, 7], 8);
      mk(sheet, 'walk-left', [8, 9, 10, 11], 8);
      mk(sheet, 'walk-right', [12, 13, 14, 15], 8);
      mk(sheet, 'idle-down', [16, 17], 2);
      mk(sheet, 'idle-up', [20, 21], 2);
      mk(sheet, 'idle-left', [24, 25], 2);
      mk(sheet, 'idle-right', [28, 29], 2);
      mk(sheet, 'sit-down', [32, 33], 2);
      mk(sheet, 'sit-up', [36, 37], 2);
      mk(sheet, 'sit-left', [40, 41], 2);
      mk(sheet, 'sit-right', [44, 45], 2);
    }
  }

  setLocalAvatar(avatar) { this.player?.setAvatar(avatar); }

  broadcastPlayer(state) { network.move(state); }

  requestMove(target, facing, reply) {
    network.move({ ...target, facing, moving: true }, ({ ok } = {}) => reply(Boolean(ok)));
  }

  syncRemotePlayers(players, selfId) {
    const live = new Set(players.filter((p) => p.id !== selfId).map((p) => p.id));
    players.forEach((player) => this.upsertRemotePlayer(player, selfId));
    for (const id of this.remotePlayers.keys()) if (!live.has(id)) this.removeRemotePlayer(id);
  }

  upsertRemotePlayer(player, selfId) {
    if (player.id === selfId) return;
    const x = player.c * TILE + TILE / 2, y = (player.r + 1) * TILE;
    let remote = this.remotePlayers.get(player.id);
    if (!remote) {
      const sprite = this.add.sprite(x, y, player.avatar, 16).setOrigin(0.5, 1).setScale(0.44).setDepth(1000);
      const overlay = this.add.sprite(x, y, player.avatar, 16).setOrigin(0.5, 1).setScale(0.44).setVisible(false);
      const label = this.add.text(x, y - 78, player.name, {
        fontFamily: 'Arial', fontSize: '9px', color: '#ffffff', backgroundColor: '#4338ca', padding: { x: 3, y: 2 },
      }).setOrigin(0.5, 1).setDepth(1001);
      remote = { sprite, overlay, label };
      this.remotePlayers.set(player.id, remote);
    }
    remote.sprite.setTexture(player.avatar);
    remote.overlay.setTexture(player.avatar);
    const chair = player.sitting ? this.chairs.find((item) => item.id === player.chairId) : null;
    if (chair) {
      const seatX = (chair.c + ((chair.width || 1) - 1) / 2) * TILE + TILE / 2 + (chair.seatOffsetX || 0);
      const baseY = (chair.r + 1) * TILE;
      const seatY = chair.facing === 'up' ? baseY - TILE - 12 : baseY - 12;
      remote.sprite.setPosition(seatX, seatY).setDepth(chair.facing === 'up' ? 1000 : 2.5)
        .play(`${player.avatar}-sit-${chair.facing}`, true);
      remote.overlay.setVisible(chair.facing === 'down').setPosition(seatX, seatY).setDepth(3.5)
        .setCrop(0, 0, 181, 105);
      if (chair.facing === 'down') remote.overlay.play(`${player.avatar}-sit-${chair.facing}`, true);
      remote.label.setPosition(seatX, seatY - 78);
      return;
    }
    remote.overlay.setVisible(false).setCrop();
    this.tweens.killTweensOf([remote.sprite, remote.label]);
    if (player.moving) {
      remote.sprite.play(`${player.avatar}-walk-${player.facing}`, true);
      this.tweens.add({ targets: remote.sprite, x, y, duration: 150, ease: 'Linear' });
      this.tweens.add({ targets: remote.label, x, y: y - 78, duration: 150, ease: 'Linear' });
    } else {
      remote.sprite.setPosition(x, y).play(`${player.avatar}-idle-${player.facing}`, true);
      remote.label.setPosition(x, y - 78);
    }
  }

  removeRemotePlayer(id) {
    const remote = this.remotePlayers.get(id);
    if (!remote) return;
    remote.sprite.destroy();
    remote.overlay.destroy();
    remote.label.destroy();
    this.remotePlayers.delete(id);
  }

  findOpenTile(c, r) {
    if (this.isWalkable(c, r)) return { c, r };
    for (let rad = 1; rad < Math.max(this.cols, this.rows); rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (this.isWalkable(c + dc, r + dr)) return { c: c + dc, r: r + dr };
        }
      }
    }
    return { c, r };
  }

  isWalkable(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return !this.blocked.has(`${c},${r}`) && !network.isOccupied(c, r);
  }

  findPath(sc, sr, tc, tr) {
    if (!this.isWalkable(tc, tr)) return [];
    const key = (c, r) => `${c},${r}`;
    const queue = [[sc, sr]];
    const came = new Map([[key(sc, sr), null]]);
    while (queue.length) {
      const [c, r] = queue.shift();
      if (c === tc && r === tr) break;
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + dc, nr = r + dr, k = key(nc, nr);
        if (!came.has(k) && this.isWalkable(nc, nr)) { came.set(k, key(c, r)); queue.push([nc, nr]); }
      }
    }
    const dest = key(tc, tr);
    if (!came.has(dest)) return [];
    const path = [];
    for (let k = dest; k; k = came.get(k)) { const [c, r] = k.split(',').map(Number); path.unshift({ c, r }); }
    path.shift();
    return path;
  }

  chairAt(c, r) {
    return this.chairs.find((chair) => c >= chair.c && c < chair.c + chair.width
      && r <= chair.r && r > chair.r - chair.height) || null;
  }

  findChairApproach(chair) {
    // Only tiles bordering the chair footprint are worth walking to; pick the nearest
    // reachable one (empty path = already adjacent, caller sits in place).
    let best = null;
    for (let c = chair.c - 1; c <= chair.c + chair.width; c++) {
      for (let r = chair.r - chair.height; r <= chair.r + 1; r++) {
        if (!this.isWalkable(c, r)) continue;
        const path = this.findPath(this.player.c, this.player.r, c, r);
        if (path.length && (!best || path.length < best.length)) best = path;
      }
    }
    return best || [];
  }

  // Bug 1 (text input focused) + Bug 2 (session popup open) → ignore game input.
  inputLocked() {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return true;
    return sessionState.open;
  }

  setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,E');
    this.input.keyboard.clearCaptures(); // let HTML inputs receive keystrokes

    this.keys.E.on('down', () => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      // E may always stand the student, even while the chair-triggered session
      // menu is open. The menu still blocks every other movement action.
      if (this.inputLocked() && !this.player.sitting) return;
      this.player.toggleSit(this.chairs);
    });

    this.input.on('pointerdown', (pointer) => {
      if (this.inputLocked()) return;
      if (pointer.x < this.viewX) return; // ignore clicks in the reserved left menu panel
      const c = Math.floor(pointer.worldX / TILE);
      const r = Math.floor(pointer.worldY / TILE);
      const chair = this.chairAt(c, r);
      if (chair) {
        const path = this.findChairApproach(chair);
        if (path.length) this.player.followPath(path, chair);
        else if (!this.player.moving) this.requestSit(chair);
        return;
      }
      const path = this.findPath(this.player.c, this.player.r, c, r);
      if (path.length) this.player.followPath(path);
    });
  }

  setupCamera() {
    const cam = this.cameras.main;
    cam.setZoom(1.5);
    this.viewX = 0;
    this.minZoom = 0.5;
    // Use the full browser viewport. Each axis independently follows the player only
    // while the zoomed map is larger than that axis; otherwise the map stays centred.
    this.applyViewport = () => {
      const sw = this.scale.width, sh = this.scale.height;
      cam.setViewport(0, 0, sw, sh);
      // Cover the complete browser viewport at minimum zoom. Using the larger
      // ratio guarantees neither axis can expose black outside the map.
      this.minZoom = Math.max(sw / this.worldW, sh / this.worldH);
      cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, 2));
      this.updateCamera(true);
    };
    this.applyViewport();
    this.scale.on('resize', this.applyViewport);
    this.input.on('wheel', (pointer, over, dx, dy) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.0015, this.minZoom, 2));
      this.updateCamera(true);
    });

  }

  drawMinimap(time) {
    if (time < (this.nextMinimapDraw || 0)) return;
    this.nextMinimapDraw = time + 100;
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas || canvas.parentElement.hidden) return;
    const ctx = canvas.getContext('2d');
    const x = 8, y = 8, w = 184, h = 164;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#dff3df'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    // A Gather-style floor plan: rooms and major furniture, not a tiny live render.
    ctx.fillStyle = '#f8ead5'; ctx.fillRect(x, y, w, 76);
    ctx.fillStyle = '#e7dff5'; ctx.fillRect(x, 94, 86, 78);
    ctx.fillStyle = '#dde9f6'; ctx.fillRect(106, 94, 86, 78);
    ctx.strokeStyle = '#9aa8b7'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 76); ctx.strokeRect(x, 94, 86, 78); ctx.strokeRect(106, 94, 86, 78);
    ctx.fillStyle = '#b77a55';
    [[20,22,54,11],[82,22,48,11],[139,22,42,11],[20,50,67,12],[103,50,70,12],
      [20,108,54,10],[20,138,60,10],[116,108,62,10],[116,138,62,10]].forEach((r) => ctx.fillRect(...r));
    ctx.fillStyle = '#c84f48'; ctx.fillRect(91, 8, 10, 76); ctx.fillRect(91, 94, 10, 78);

    const dot = (c, r, color, radius) => {
      ctx.beginPath(); ctx.arc(x + (c / this.cols) * w, y + (r / this.rows) * h, radius, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    };
    for (const p of network.playerPositions()) if (!p.self) dot(p.c, p.r, '#f59e0b', 4);
    dot(this.player.c, this.player.r, '#22c55e', 4.5);
  }

  updateCamera(immediate = false) {
    const cam = this.cameras.main;
    const visibleW = cam.width / cam.zoom;
    const visibleH = cam.height / cam.zoom;
    const targetCenterX = visibleW >= this.worldW
      ? this.worldW / 2
      : Phaser.Math.Clamp(this.player.sprite.x, visibleW / 2, this.worldW - visibleW / 2);
    const targetCenterY = visibleH >= this.worldH
      ? this.worldH / 2
      : Phaser.Math.Clamp(this.player.sprite.y, visibleH / 2, this.worldH - visibleH / 2);
    if (immediate) {
      cam.centerOn(targetCenterX, targetCenterY);
      return;
    }
    cam.centerOn(
      Phaser.Math.Linear(cam.midPoint.x, targetCenterX, 0.12),
      Phaser.Math.Linear(cam.midPoint.y, targetCenterY, 0.12),
    );
  }

  update(time) {
    if (this.player) this.player.update();
    if (this.player) this.updateCamera();
    if (this.player) this.drawMinimap(time);
  }
}
