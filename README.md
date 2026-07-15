# Study Desk Library

A cozy multiplayer 2D study library where friends can walk, sit at reading desks,
run focus/pomodoro sessions, and talk in proximity-based communication bubbles.

Built with plain HTML/CSS/JS + [Phaser 3](https://phaser.io) (loaded from a CDN)
and an Express + Socket.IO server. **No build step.**

## Install & run

```bash
npm install
npm start
```

Then open the URL it prints:

```
http://localhost:3000
```

Without a database, opening `/` creates a temporary private room URL. With Supabase
configured, authenticated users create or join persistent libraries instead.

(Set a different port with `PORT=4000 npm start`.)

## Deploy as a separate Fly.io app

Production requires Google authentication and a Supabase Free Postgres database:

1. In Google Cloud, create an OAuth client with application type **Web application**.
2. Add `http://localhost:3000` and `https://study-desk-library.fly.dev` as Authorized JavaScript origins.
3. Create a Supabase Free project. In its **SQL Editor**, run
   [`database/schema.sql`](database/schema.sql) once.
4. Open **Connect**, choose the **Session pooler** connection string (Fly supports
   this IPv4-compatible option), and replace the password placeholder with your
   database password.
5. Set the server-only database URL, public Google client ID, and random session
   signing secret. Never put the database URL in client-side code:

   ```bash
   fly secrets set --app study-desk-library GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com" SESSION_SECRET="a-random-value-at-least-32-characters" DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres?sslmode=require" DATABASE_REQUIRED="true"
   ```

6. Run `fly deploy --ha=false`.
7. Keep one Machine while live multiplayer state is stored in memory:
   `fly scale count 1 --app study-desk-library`.

Local development stays in guest mode unless `GOOGLE_CLIENT_ID` and `SESSION_SECRET` are set.

The health check is available at `/health`. Accounts, libraries, memberships, and
study-session records persist in Supabase. Live positions, chat bubbles, and occupied
chairs intentionally reset when the Machine restarts.

## Controls

| Action            | Keys                                   |
| ----------------- | -------------------------------------- |
| Move              | Arrow keys **or** WASD                 |
| Click-to-move     | Click any floor tile                   |
| Sit / stand       | **E** (when on or next to a chair)     |
| Enter/open chat   | **C** near another student             |
| Start a session   | Use the **Start Session** popup        |

## What's here

- Express server serving `/client` and `/assets`.
- A cozy library room built from the LimeZu tileset (herringbone floor, walls of
  bookshelves, reading desks with chairs, a rug).
- One local player (LimeZu "Adam") with idle / walk / sit animations, wall &
  furniture collision, and correct top-down depth sorting by base-Y.
- Server-controlled communication bubbles: open bubbles are white and joinable;
  a member can lock one red so no additional students can enter its sidebar chat.
- A Gather-style **Start Session** popup: Focus / Pomodoro tabs, durations, an
  optional topic, a calm-music picker (with volume), and a timestamp-based
  countdown that auto-switches focus ⇄ break in Pomodoro mode.

## Assets

Real art/audio is loaded from `assets/`. If a specific file is missing, the game
falls back to a colored placeholder and logs the expected path to the console
(music options for missing audio files are simply hidden).

---

Google credentials are verified by the server. The browser receives only a signed,
HTTP-only Study Desk session cookie; no Google access token is stored.

## Security invariants

- Authentication, library membership, chair ownership, and chat admission are
  decided by the server, never by browser state.
- SQL stays parameterized and the Supabase connection string stays server-only.
- New request and Socket.IO payloads must be bounded, normalized, rate-limited
  where abusable, and rendered with safe DOM APIs rather than raw HTML.
- Production changes should keep generic client errors, secret-free logs, pinned
  dependencies, security headers, HTTPS, and signed HTTP-only cookies intact.
