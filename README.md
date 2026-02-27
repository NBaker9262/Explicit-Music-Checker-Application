# Explicit-Music-Checker-Application

Dance-focused song request app with two separate experiences:

- Public request board for guests/students to search and submit songs.
- Admin dashboard for moderation, scheduling, and analytics.

## Live page structure

- `/` public request page
- `/admin/login.html` admin login
- `/admin/dashboard.html` admin control center

Legacy pages (`/submit.html`, `/queue.html`, `/analytics.html`) now redirect.

## Admin credentials

This build uses:

- Username: `admin`
- Password: `D3f3nd3rs`

The same defaults are in code, and also set in `wrangler.toml` vars.

## API overview

### Public endpoints

- `GET /api/health`
- `GET /api/public/spotify/search?q=...`
- `POST /api/public/request`
- `GET /api/public/queue`
- `GET /api/public/feed`

### Admin endpoints (auth required)

Send `Authorization: Basic <base64(username:password)>`

- `POST /api/admin/login`
- `GET /api/admin/session`
- `GET /api/admin/queue`
- `PATCH /api/admin/queue/:id`
- `POST /api/admin/bulk`
- `GET /api/admin/analytics`

## Dance-specific request fields

Requests now capture:

- dance moment (`anytime`, `grand_entrance`, `warmup`, `peak_hour`, `slow_dance`, `last_dance`)
- energy level (1-5)
- vibe tags
- dedication message

These fields feed priority scoring and analytics.

## Local development

1. Install dependencies:
   - `npm install`
2. Set Spotify credentials:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
3. (Optional) override admin credentials:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
4. Start server:
   - `npm start`
5. Open:
   - `http://localhost:3000`

## Cloudflare Worker + D1

1. Install dependencies:
   - `npm install`
2. Login:
   - `npx wrangler login`
3. Apply migrations:
   - Local: `npm run cf:migrate:local`
   - Remote: `npm run cf:migrate:remote`
4. Set Spotify secrets:
   - `npx wrangler secret put SPOTIFY_CLIENT_ID`
   - `npx wrangler secret put SPOTIFY_CLIENT_SECRET`
5. Deploy API:
   - `npm run cf:deploy`

## Frontend API target

`public/js/config.js` automatically uses:

- local API when on localhost
- `https://music-queue-api.noahmathmaster.workers.dev` in production

If your Worker URL changes, update `apiBaseUrl` in `public/js/config.js`.
