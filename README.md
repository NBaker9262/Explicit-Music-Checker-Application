# Explicit-Music-Checker-Application

A Spotify-based song request app with queue moderation and analytics.

## What this app now supports

- Search Spotify tracks.
- Submit requests with requester role and optional event date.
- Duplicate request detection (joins existing pending request and increments vote count).
- Content confidence tags (`clean`, `explicit`, `unknown`).
- Moderation presets during review (instead of free-text-only moderation).
- Priority scoring based on vote count, requester role, event date urgency, and confidence.
- Analytics dashboard for top artists, approval rate, and most rejected tracks.

## App routes

- `/` search and select a song
- `/submit.html` submit request details
- `/queue.html` moderation queue
- `/analytics.html` analytics dashboard

## API routes

- `GET /api/health`
- `GET /api/spotify/search?q=...`
- `GET /api/queue`
- `POST /api/queue`
- `PATCH /api/queue/:id`
- `GET /api/analytics`

## Local development (Express)

1. Install dependencies:
   - `npm install`
2. Set Spotify credentials:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
3. Start server:
   - `npm start`
4. Open:
   - `http://localhost:3000`

## Cloudflare Worker + D1 setup

1. Install dependencies:
   - `npm install`
2. Login to Cloudflare:
   - `npx wrangler login`
3. Create D1 database (once):
   - `npx wrangler d1 create music-queue`
4. Put your `database_id` in `wrangler.toml`.
5. Apply migrations:
   - Local: `npm run cf:migrate:local`
   - Remote: `npm run cf:migrate:remote`
6. Set Worker secrets:
   - `npx wrangler secret put SPOTIFY_CLIENT_ID`
   - `npx wrangler secret put SPOTIFY_CLIENT_SECRET`
7. Run locally with Worker runtime:
   - `npm run cf:dev`
8. Deploy API:
   - `npm run cf:deploy`

## Frontend API config

Edit `public/js/config.js` and point `apiBaseUrl` to your deployed Worker URL.
The current config already uses same-origin API on localhost and Worker API in production.

Example:

```js
window.APP_CONFIG = {
  apiBaseUrl: 'https://music-queue-api.your-subdomain.workers.dev'
};
```

## Why your previous Cloudflare 404 happened

Your frontend was calling a Worker URL that did not match the active Worker service and `config.js` contained a debugger URL value.

Use the Worker URL from `wrangler deploy` output and keep `public/js/config.js` aligned with that URL.
