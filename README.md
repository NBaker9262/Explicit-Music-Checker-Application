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

Admin credentials are required and must be configured via environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

## API overview

### Public endpoints

- `GET /api/health`
- `GET /api/public/spotify/search?q=...`
- `GET /api/public/spotify/album/:id/tracks`
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

## Lyrics + moderation pipeline (free)

Every public request now runs this backend flow before final status is set:

1. Try to fetch lyrics from free APIs:
   - `lyrics.ovh`
   - `lrclib`
2. Run OpenAI moderation (`omni-moderation-latest`) on lyrics text.
3. Run theme keyword scoring for:
   - suggestive themes
   - alcohol
   - drugs
   - violence
4. Combine that with Spotify explicit flag + existing score model:
   - `approved` when low risk
   - `pending` (shown as flagged) when medium risk
   - `rejected` (shown as explicit) when high risk or profanity/explicit

Notes:
- Uses OpenAI Moderation endpoint plus free lyrics APIs.
- Based on OpenAI docs/pricing, moderation is free for API users.
- If lyrics providers fail, the app falls back to the existing moderation logic.
- You can disable lyrics moderation for debugging by setting Worker var `DISABLE_LYRICS_MODERATION=1`.

## Local development

1. Install dependencies:
   - `npm install`
2. Set Spotify credentials:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
3. (Optional) set OpenAI moderation key:
   - `OPENAI_API_KEY`
4. Set admin credentials:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
5. Start server:
   - `npm start`
6. Open:
   - `http://localhost:3000`

## Cloudflare Worker + D1

1. Install dependencies:
   - `npm install`
2. Login:
   - `npm run cf:whoami`
   - if needed: `npx wrangler login`
3. Apply migrations:
   - Check pending: `npm run cf:migrate:list:remote`
   - Local: `npm run cf:migrate:local`
   - Remote: `npm run cf:migrate:remote`
4. Set allowed frontend origins:
   - set `ALLOWED_ORIGIN` to a comma-separated list of trusted frontend domains
5. Set Spotify secrets:
   - `npm run cf:secret:put -- SPOTIFY_CLIENT_ID`
   - `npm run cf:secret:put -- SPOTIFY_CLIENT_SECRET`
6. Set OpenAI moderation key:
   - `npm run cf:secret:put -- OPENAI_API_KEY`
7. Set admin credentials:
   - `npm run cf:secret:put -- ADMIN_USERNAME`
   - `npm run cf:secret:put -- ADMIN_PASSWORD`
8. (Optional) disable lyrics moderation:
   - `npm run cf:secret:put -- DISABLE_LYRICS_MODERATION`
   - enter `1` when prompted
9. (Optional) manage secrets in bulk:
   - copy `cloudflare/secrets.example.json` to a local untracked file (for example `cloudflare/secrets.json`)
   - run: `npm run cf:secret:bulk -- cloudflare/secrets.json`
10. Deploy API:
   - `npm run cf:deploy`

## Wrangler command quick reference

- `npm run cf:whoami` show active Cloudflare account and token scopes
- `npm run cf:d1:list` list D1 databases
- `npm run cf:migrate:list:local` list local pending migrations
- `npm run cf:migrate:list:remote` list remote pending migrations
- `npm run cf:secret:list` list Worker secrets
- `npm run cf:secret:put -- <KEY>` create/update a secret
- `npm run cf:secret:delete -- <KEY>` remove a secret
- `npm run cf:secret:bulk -- <FILE>` upload secrets from JSON file
- `npm run cf:deployments` list recent Worker deployments
- `npm run cf:tail` stream Worker logs

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
