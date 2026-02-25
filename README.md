# Explicit-Music-Checker-Application
An app for searching Spotify tracks, selecting an exact song, submitting a request, and managing a review queue.

## Current flow

1. Search for a song on the main page (`/`).
2. Select one track from Spotify search results.
3. Continue to the submit page (`/submit.html`) and add requester name and optional custom message.
4. Submit to the server queue.
5. Review queue items on `/queue.html` and mark status as pending, approved, or rejected.

## Notes

- The legacy UI has been archived to `archive/old-legacy`.
- The original Express queue is in-memory and resets on restart.

## Cloudflare free setup (beginner)

This repository now includes a Cloudflare Worker API with D1 SQL persistence.

### Where to do each step

- **Cloudflare Dashboard (browser):** create D1 database, check data in SQL console.
- **GitHub Codespace terminal:** install tools, run commands, migrate database, deploy Worker.
- **Local browser / localhost:** run frontend locally while calling Worker API.

### 1) One-time setup in Codespaces

1. Run: `npm install`
2. Run: `npx wrangler login` (opens browser, you approve access)
3. In Cloudflare Dashboard, create a D1 database named `music-queue`
4. Run: `npx wrangler d1 list`
5. Copy your database id into `wrangler.toml` for `database_id`

### 2) Create table in D1 (remote)

1. Run: `npm run cf:migrate:remote`
2. This applies `cloudflare/migrations/0001_init.sql`

### 3) Set Worker secrets (Spotify)

Run these in terminal:

- `npx wrangler secret put SPOTIFY_CLIENT_ID`
- `npx wrangler secret put SPOTIFY_CLIENT_SECRET`

### 4) Local development in Codespaces

1. Start Worker API: `npm run cf:dev`
2. Wrangler prints a local URL (example: `http://127.0.0.1:8787`)
3. Keep that running.
4. In another terminal, run your frontend however you prefer (for example a simple static server).

If frontend is on a different host/port, edit `public/js/config.js`:

```js
window.APP_CONFIG = {
	apiBaseUrl: 'http://127.0.0.1:8787'
};
```

### 5) Deploy for public use

1. Deploy API: `npm run cf:deploy`
2. Copy your Worker URL (ends with `.workers.dev`)
3. Update `public/js/config.js`:

```js
window.APP_CONFIG = {
	apiBaseUrl: 'https://your-worker-name.your-subdomain.workers.dev'
};
```

4. Deploy frontend to Cloudflare Pages (connect this GitHub repo in Dashboard).
5. Open your Pages URL and test search/submit/queue.

### 6) CORS for production

- `wrangler.toml` has `ALLOWED_ORIGIN`.
- For quick setup, keep `*`.
- For stricter security later, set it to your Pages URL and redeploy.

## Files added for Cloudflare

- `cloudflare/worker.js` (API routes + D1 + Spotify proxy)
- `cloudflare/migrations/0001_init.sql` (database schema)
- `wrangler.toml` (Worker + D1 binding)
- `public/js/config.js` (frontend API base URL)
