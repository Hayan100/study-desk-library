# Study Library — Step 1 (single-player)

A cozy top-down 2D "study library" you can walk around in, sit at a reading desk,
and run a focus/pomodoro session with calm background music. Local testing only.

Built with plain HTML/CSS/JS + [Phaser 3](https://phaser.io) (loaded from a CDN)
and a tiny Express static server. **No build step.**

## Install & run

```bash
npm install
npm start
```

Then open the URL it prints:

```
http://localhost:3000
```

Opening `/` creates a private room URL. Use the sidebar **Invite** button to copy that URL for friends.

(Set a different port with `PORT=4000 npm start`.)

## Deploy as a separate Fly.io app

1. Change `app` in `fly.toml` if `study-desk-library` is already taken.
2. Run `fly launch --copy-config --no-deploy`.
3. Run `fly deploy`.
4. Keep one Machine while multiplayer state is stored in memory: `fly scale count 1`.

The health check is available at `/health`. Active rooms and occupied chairs reset when the Machine restarts.

## Controls

| Action            | Keys                                   |
| ----------------- | -------------------------------------- |
| Move              | Arrow keys **or** WASD                 |
| Click-to-move     | Click any floor tile                   |
| Sit / stand       | **E** (when on or next to a chair)     |
| Start a session   | Use the **Start Session** popup        |

## What's here

- Express server serving `/client` and `/assets`.
- A cozy library room built from the LimeZu tileset (herringbone floor, walls of
  bookshelves, reading desks with chairs, a rug).
- One local player (LimeZu "Adam") with idle / walk / sit animations, wall &
  furniture collision, and correct top-down depth sorting by base-Y.
- A Gather-style **Start Session** popup: Focus / Pomodoro tabs, durations, an
  optional topic, a calm-music picker (with volume), and a timestamp-based
  countdown that auto-switches focus ⇄ break in Pomodoro mode.

## Assets

Real art/audio is loaded from `assets/`. If a specific file is missing, the game
falls back to a colored placeholder and logs the expected path to the console
(music options for missing audio files are simply hidden).

---

> **Step 2** adds Socket.io multiplayer (see the `TODO(step2 …)` comments in
> `server.js` and the client `js/` modules for the exact hook points).
