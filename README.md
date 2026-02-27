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
- `POST /api/admin/reorder`
- `POST /api/admin/control`
- `GET /api/admin/analytics`

## Current queue model

- `approved` songs: playable queue
- `pending` songs: shown as `flagged`, keep line position, skipped during playback
- `rejected` songs: shown as `explicit`, tracked only, never played

The admin page supports drag reorder for active queue positions and bottom control actions (`play_next_approved`, clear actions, and queue renumber).

## Request rate limit

- Public requests are limited to `1 request per IP every 10 minutes`.
- API returns `429` with `retryAfterSec` and `nextAllowedAt` when limited.
- Public UI shows a modal and cooldown timer so users know exactly when they can request again.

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

## Production notes

- Public app URL:
  - `https://explicit-music-checker-application.noahmathmaster.workers.dev`
- API Worker URL:
  - `https://music-queue-api.noahmathmaster.workers.dev`
- Public pages should call the API Worker URL via `public/js/config.js`.
