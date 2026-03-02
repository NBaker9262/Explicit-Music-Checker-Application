
function parseAllowedOrigins(rawAllowedOrigin) {
  const value = String(rawAllowedOrigin || '*').trim();
  if (!value) return ['*'];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function buildCorsHeaders(request, rawAllowedOrigin) {
  const allowedOrigins = parseAllowedOrigins(rawAllowedOrigin);
  const requestOrigin = request.headers.get('Origin') || '';

  let origin = '*';
  if (!allowedOrigins.includes('*')) {
    origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  };
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected'];
const ALLOWED_ROLES = ['guest', 'student', 'staff', 'organizer', 'dj', 'admin'];
const ALLOWED_CONFIDENCE = ['clean', 'explicit', 'unknown'];
const ALLOWED_DANCE_MOMENTS = ['anytime', 'grand_entrance', 'warmup', 'peak_hour', 'slow_dance', 'last_dance'];
const ALLOWED_VIBE_TAGS = ['throwback', 'hiphop', 'pop', 'latin', 'afrobeats', 'country', 'rnb', 'edm', 'line_dance', 'singalong'];
const MODERATION_PRESETS = [
  'clean_version_verified',
  'duplicate_request_merged',
  'explicit_lyrics',
  'violence',
  'hate_speech',
  'sexual_content',
  'policy_violation',
  'other'
];

const ROLE_WEIGHTS = { guest: 4, student: 8, staff: 14, organizer: 22, dj: 30, admin: 30 };
const MOMENT_WEIGHTS = { anytime: 3, grand_entrance: 14, warmup: 6, peak_hour: 18, slow_dance: 8, last_dance: 20 };
const MODERATION_TERMS = ['explicit', 'uncensored', 'dirty', 'parental advisory', 'violence', 'gun', 'drug', 'sex'];
const LYRICS_OVH_BASE_URL = 'https://api.lyrics.ovh/v1';
const LRCLIB_BASE_URL = 'https://lrclib.net/api/get';
const OPENAI_MODERATIONS_URL = 'https://api.openai.com/v1/moderations';
const SOUND_CLOUD_TRACKS_BASE_URL = 'https://api.soundcloud.com/tracks';
const SOUND_CLOUD_SEARCH_V2_URL = 'https://api-v2.soundcloud.com/search/tracks';
const SOUND_CLOUD_OAUTH_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const SOUND_CLOUD_OAUTH_TOKEN_FALLBACK_URL = 'https://api.soundcloud.com/oauth2/token';
const SOUND_CLOUD_PUBLIC_SEARCH_PAGE_URL = 'https://soundcloud.com/search/sounds';
const LYRICS_MODERATION_HINT_TERMS = {
  suggestive: ['sex', 'sexy', 'bed', 'naked', 'freak', 'hook up', 'make love', 'twerk'],
  alcohol: ['alcohol', 'drink', 'drunk', 'whiskey', 'vodka', 'tequila', 'beer', 'wine', 'shots', 'bar', 'bottle', 'liquor'],
  drugs: ['drug', 'drugs', 'weed', 'marijuana', 'cocaine', 'crack', 'meth', 'heroin', 'xanax', 'molly', 'ecstasy', 'lean', 'pills'],
  violence: ['gun', 'guns', 'shoot', 'murder', 'kill', 'blood', 'knife', 'fight', 'dead', 'die']
};
const LOCAL_PROFANITY_TERMS = ['fuck', 'fucking', 'shit', 'bitch', 'motherfucker', 'asshole', 'dick', 'pussy', 'nigga', 'nigger', 'cunt'];
const DEFAULT_SAFE_TRACK_EXCEPTIONS = ['titanium'];
const DEFAULT_STRICT_BLOCKED_TRACKS = ['california gurls'];
const MODERATION_REASON_SUMMARY = {
  clean_version_verified: 'Allowed: listed as a verified clean exception.',
  explicit_lyrics: 'Blocked: explicit/profane lyrics detected.',
  violence: 'Blocked: violent language or themes detected.',
  hate_speech: 'Blocked: hate speech risk detected.',
  sexual_content: 'Blocked: sexual content/themes detected.',
  policy_violation: 'Blocked: school policy risk (drugs/alcohol/unsafe themes).',
  other: 'Blocked: marked unsafe by DJ moderation.'
};

const MODERATION_REASON_LABELS = {
  clean_version_verified: 'Clean exception match',
  duplicate_request_merged: 'Duplicate merged',
  explicit_lyrics: 'Explicit lyrics',
  violence: 'Violence risk',
  hate_speech: 'Hate speech risk',
  sexual_content: 'Sexual content risk',
  policy_violation: 'Policy risk',
  other: 'DJ safety decision'
};
const NIGHTLY_BENCHMARK_SONG_POOL = [
  { name: 'Titanium', artist: 'David Guetta', explicit: false, bucket: 'good' },
  { name: 'Happy', artist: 'Pharrell Williams', explicit: false, bucket: 'good' },
  { name: 'Uptown Funk', artist: 'Mark Ronson', explicit: false, bucket: 'good' },
  { name: 'Firework', artist: 'Katy Perry', explicit: false, bucket: 'good' },
  { name: 'Shut Up and Dance', artist: 'Walk the Moon', explicit: false, bucket: 'good' },
  { name: 'Best Day of My Life', artist: 'American Authors', explicit: false, bucket: 'good' },
  { name: 'Can\'t Stop the Feeling', artist: 'Justin Timberlake', explicit: false, bucket: 'good' },
  { name: 'Treasure', artist: 'Bruno Mars', explicit: false, bucket: 'good' },
  { name: 'Levitating', artist: 'Dua Lipa', explicit: false, bucket: 'edge' },
  { name: 'Peaches', artist: 'Justin Bieber', explicit: false, bucket: 'edge' },
  { name: 'Wild Thoughts', artist: 'DJ Khaled', explicit: false, bucket: 'edge' },
  { name: 'Talk Dirty', artist: 'Jason Derulo', explicit: false, bucket: 'edge' },
  { name: 'S&M', artist: 'Rihanna', explicit: false, bucket: 'edge' },
  { name: 'Gold Digger', artist: 'Kanye West', explicit: false, bucket: 'edge' },
  { name: 'Blurred Lines', artist: 'Robin Thicke', explicit: false, bucket: 'edge' },
  { name: 'Cake By The Ocean', artist: 'DNCE', explicit: false, bucket: 'edge' },
  { name: 'WAP', artist: 'Cardi B', explicit: true, bucket: 'bad' },
  { name: 'Anaconda', artist: 'Nicki Minaj', explicit: true, bucket: 'bad' },
  { name: 'Mask Off', artist: 'Future', explicit: true, bucket: 'bad' },
  { name: 'No Role Modelz', artist: 'J. Cole', explicit: true, bucket: 'bad' },
  { name: 'Get Low', artist: 'Lil Jon', explicit: true, bucket: 'bad' },
  { name: 'Back That Azz Up', artist: 'Juvenile', explicit: true, bucket: 'bad' },
  { name: 'Pound Town', artist: 'Sexyy Red', explicit: true, bucket: 'bad' },
  { name: 'Super Gremlin', artist: 'Kodak Black', explicit: true, bucket: 'bad' }
];
const REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1000;
let rateLimitSchemaReady = false;
let moderationLearningSchemaReady = false;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function getClientIp(request) {
  const cfIp = sanitizeText(request.headers.get('CF-Connecting-IP') || '', 80);
  if (cfIp) return cfIp;
  const forwardedFor = sanitizeText(request.headers.get('X-Forwarded-For') || '', 200);
  if (!forwardedFor) return 'unknown';
  const first = forwardedFor.split(',')[0] || '';
  const parsed = sanitizeText(first, 80);
  return parsed || 'unknown';
}

function parseIsoDateMs(value) {
  const raw = sanitizeText(value, 50);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureRateLimitTable(env) {
  if (rateLimitSchemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS request_rate_limits (
      ip_address TEXT PRIMARY KEY,
      last_request_at TEXT NOT NULL
    )`
  ).run();
  rateLimitSchemaReady = true;
}

async function checkAndConsumeRateLimit(env, ipAddress) {
  const key = sanitizeText(ipAddress || 'unknown', 80) || 'unknown';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  await ensureRateLimitTable(env);
  const existing = await env.DB.prepare(
    'SELECT last_request_at FROM request_rate_limits WHERE ip_address = ?'
  ).bind(key).first();

  const lastMs = parseIsoDateMs(existing?.last_request_at);
  if (lastMs !== null) {
    const elapsed = nowMs - lastMs;
    if (elapsed < REQUEST_LIMIT_WINDOW_MS) {
      const waitMs = REQUEST_LIMIT_WINDOW_MS - elapsed;
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      const nextAllowedAt = new Date(lastMs + REQUEST_LIMIT_WINDOW_MS).toISOString();
      return { allowed: false, retryAfterSec, nextAllowedAt };
    }
  }

  await env.DB.prepare(
    `INSERT INTO request_rate_limits (ip_address, last_request_at)
     VALUES (?, ?)
     ON CONFLICT(ip_address) DO UPDATE SET last_request_at = excluded.last_request_at`
  ).bind(key, nowIso).run();

  return {
    allowed: true,
    retryAfterSec: Math.ceil(REQUEST_LIMIT_WINDOW_MS / 1000),
    nextAllowedAt: new Date(nowMs + REQUEST_LIMIT_WINDOW_MS).toISOString()
  };
}

function normalizeRole(role) {
  const normalized = sanitizeText(role, 20).toLowerCase();
  return ALLOWED_ROLES.includes(normalized) ? normalized : 'guest';
}

function normalizeStatus(status) {
  const normalized = sanitizeText(status, 20).toLowerCase();
  return ALLOWED_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeModerationReason(reason) {
  const normalized = sanitizeText(reason, 64).toLowerCase();
  if (!normalized) return '';
  return MODERATION_PRESETS.includes(normalized) ? normalized : null;
}

function normalizeIsoDate(dateValue) {
  const raw = sanitizeText(dateValue, 20);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return raw;
}

function deriveContentConfidence(explicitFlag) {
  if (explicitFlag === 'explicit') return 'explicit';
  if (explicitFlag === 'clean') return 'clean';
  if (explicitFlag === 'unknown') return 'unknown';
  if (explicitFlag === true || explicitFlag === 1) return 'explicit';
  if (explicitFlag === false || explicitFlag === 0) return 'clean';
  return 'unknown';
}

function calculateModerationScore({ trackName, artists, contentConfidence }) {
  const confidence = deriveContentConfidence(contentConfidence);
  let score = confidence === 'clean' ? 92 : confidence === 'explicit' ? 8 : 62;
  const haystack = `${sanitizeText(trackName, 200)} ${(artists || []).join(' ')}`.toLowerCase();

  MODERATION_TERMS.forEach((term) => {
    if (haystack.includes(term)) score -= 12;
  });

  return clampNumber(score, 0, 100);
}

function splitTextByLength(text, maxChunkLength = 240) {
  const safeText = sanitizeText(text, 30000);
  if (!safeText) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < safeText.length && chunks.length < 8) {
    chunks.push(safeText.slice(cursor, cursor + maxChunkLength));
    cursor += maxChunkLength;
  }
  return chunks;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countKeywordHits(text, keywords) {
  const haystack = sanitizeText(text, 30000).toLowerCase();
  if (!haystack) return 0;

  let count = 0;
  (keywords || []).forEach((keyword) => {
    const token = sanitizeText(keyword, 60).toLowerCase();
    if (!token) return;

    if (token.includes(' ')) {
      const occurrences = haystack.split(token).length - 1;
      count += Math.max(0, occurrences);
      return;
    }

    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, 'gi');
    const matches = haystack.match(regex);
    count += matches ? matches.length : 0;
  });

  return count;
}

function normalizeArtistForLyrics(artist) {
  return sanitizeText(String(artist || '').split(',')[0].split('&')[0].split(' feat')[0], 120);
}

function normalizeTitleForLyrics(title) {
  const safeTitle = sanitizeText(title, 200);
  return sanitizeText(
    safeTitle
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/-+\s*(remaster|radio edit|clean|explicit).*/i, '')
      .trim(),
    200
  );
}

function normalizeTrackExceptionKey(value) {
  const normalized = sanitizeText(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '), 200);
  return normalized.replace(/\s+/g, ' ').trim();
}

function normalizeModerationLearningKeyPart(value) {
  const normalized = sanitizeText(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '), 220);
  return normalized.replace(/\s+/g, ' ').trim();
}

function buildModerationLearningKey(trackName, artists) {
  const songKey = normalizeModerationLearningKeyPart(trackName);
  const artistKey = (Array.isArray(artists) ? artists : [])
    .map((artist) => normalizeModerationLearningKeyPart(artist))
    .filter(Boolean)
    .sort()
    .join(' ');
  if (!songKey || !artistKey) return '';
  return `${songKey}::${artistKey}`;
}

function getSafeTrackExceptionSet(env) {
  const raw = sanitizeText(env?.SAFE_TRACK_EXCEPTIONS || '', 2000);
  const entries = raw
    ? raw.split(',').map((entry) => normalizeTrackExceptionKey(entry)).filter(Boolean)
    : [];
  DEFAULT_SAFE_TRACK_EXCEPTIONS.forEach((entry) => {
    const key = normalizeTrackExceptionKey(entry);
    if (key && !entries.includes(key)) entries.push(key);
  });
  return new Set(entries);
}

function isSafeTrackException(trackName, env) {
  const key = normalizeTrackExceptionKey(trackName);
  if (!key) return false;
  const exceptions = getSafeTrackExceptionSet(env);
  return exceptions.has(key);
}

function getStrictBlockedTrackSet(env) {
  const raw = sanitizeText(env?.STRICT_BLOCK_TRACKS || '', 3000);
  const entries = raw
    ? raw.split(',').map((entry) => normalizeTrackExceptionKey(entry)).filter(Boolean)
    : [];
  DEFAULT_STRICT_BLOCKED_TRACKS.forEach((entry) => {
    const key = normalizeTrackExceptionKey(entry);
    if (key && !entries.includes(key)) entries.push(key);
  });
  return new Set(entries);
}

function isStrictBlockedTrack(trackName, env) {
  const key = normalizeTrackExceptionKey(trackName);
  if (!key) return false;
  return getStrictBlockedTrackSet(env).has(key);
}

function isSchoolSafeStrictMode(env) {
  return String(env?.SCHOOL_SAFE_MODE || '1') !== '0';
}

function buildFilterSummary({ status, moderationReason, reviewNote, contentConfidence }) {
  const normalizedStatus = normalizeStatus(status) || 'pending';
  const reason = sanitizeText(moderationReason || '', 64).toLowerCase();
  const note = sanitizeText(reviewNote || '', 500);
  const confidence = deriveContentConfidence(contentConfidence);

  if (normalizedStatus === 'approved') {
    if (reason && MODERATION_REASON_SUMMARY[reason]) return MODERATION_REASON_SUMMARY[reason];
    if (confidence === 'clean') return 'Allowed: passed strict school-safe checks.';
    return 'Allowed: approved by DJ review.';
  }

  if (normalizedStatus === 'pending') {
    if (/openai fallback unavailable/i.test(note)) {
      return 'Review: automated safety check was incomplete, waiting for DJ review.';
    }
    return 'Flagged for DJ review before queue placement.';
  }

  if (reason && MODERATION_REASON_SUMMARY[reason]) return MODERATION_REASON_SUMMARY[reason];
  if (/school safety blocklist/i.test(note)) return 'Blocked: on school blocklist.';
  if (/profanity|explicit|sexual|violence|drug|alcohol/i.test(note)) {
    return 'Blocked: lyrics/themes do not meet school-safe rules.';
  }
  return 'Blocked: failed school-safe moderation.';
}

function buildFilterExplanation({ status, moderationReason, reviewNote, contentConfidence }) {
  const normalizedStatus = normalizeStatus(status) || 'pending';
  const reason = sanitizeText(moderationReason || '', 64).toLowerCase();
  const note = sanitizeText(reviewNote || '', 500);
  const confidence = deriveContentConfidence(contentConfidence);

  const reasonLabel = reason && MODERATION_REASON_LABELS[reason]
    ? MODERATION_REASON_LABELS[reason]
    : normalizedStatus === 'approved'
      ? 'Approved'
      : normalizedStatus === 'pending'
        ? 'Needs DJ review'
        : 'Blocked';

  const detail = [];
  if (confidence === 'clean') detail.push('Spotify explicit flag: clean');
  if (confidence === 'explicit') detail.push('Spotify explicit flag: explicit');
  if (confidence === 'unknown') detail.push('Spotify explicit flag: unknown');

  note.split('|').map((part) => sanitizeText(part, 180)).filter(Boolean).slice(0, 6).forEach((entry) => {
    detail.push(entry);
  });

  return {
    reasonLabel,
    detail: detail.join(' | '),
    moderationReasonCode: reason || ''
  };
}

async function ensureModerationLearningTable(env) {
  if (moderationLearningSchemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moderation_learning (
      track_key TEXT PRIMARY KEY,
      track_name TEXT NOT NULL,
      artists_key TEXT NOT NULL,
      approved_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL
    )`
  ).run();
  moderationLearningSchemaReady = true;
}

async function recordModerationFeedback(env, { trackName, artists, status }) {
  const normalizedStatus = normalizeStatus(status);
  const trackKey = buildModerationLearningKey(trackName, artists);
  if (!trackKey || !normalizedStatus) return;

  await ensureModerationLearningTable(env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO moderation_learning
      (track_key, track_name, artists_key, approved_count, pending_count, rejected_count, last_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_key) DO UPDATE SET
      approved_count = approved_count + excluded.approved_count,
      pending_count = pending_count + excluded.pending_count,
      rejected_count = rejected_count + excluded.rejected_count,
      last_status = excluded.last_status,
      updated_at = excluded.updated_at`
  ).bind(
    trackKey,
    sanitizeText(trackName, 200),
    (Array.isArray(artists) ? artists : []).map((artist) => sanitizeText(artist, 120)).filter(Boolean).sort().join(','),
    normalizedStatus === 'approved' ? 1 : 0,
    normalizedStatus === 'pending' ? 1 : 0,
    normalizedStatus === 'rejected' ? 1 : 0,
    normalizedStatus,
    now
  ).run();
}

async function getModerationLearningHint(env, { trackName, artists }) {
  const trackKey = buildModerationLearningKey(trackName, artists);
  if (!trackKey) return null;
  await ensureModerationLearningTable(env);
  const row = await env.DB.prepare(
    `SELECT approved_count, pending_count, rejected_count, last_status, updated_at
     FROM moderation_learning WHERE track_key = ? LIMIT 1`
  ).bind(trackKey).first();
  if (!row) return null;

  const approvedCount = Math.max(0, Number(row.approved_count) || 0);
  const pendingCount = Math.max(0, Number(row.pending_count) || 0);
  const rejectedCount = Math.max(0, Number(row.rejected_count) || 0);
  const totalFeedback = approvedCount + pendingCount + rejectedCount;
  if (totalFeedback < 2) return null;

  const statuses = [
    { status: 'approved', count: approvedCount },
    { status: 'pending', count: pendingCount },
    { status: 'rejected', count: rejectedCount }
  ].sort((left, right) => right.count - left.count);
  const preferred = statuses[0];
  const confidence = preferred.count / totalFeedback;

  return {
    approvedCount,
    pendingCount,
    rejectedCount,
    totalFeedback,
    preferredStatus: preferred.status,
    confidence,
    updatedAt: sanitizeText(row.updated_at || '', 40)
  };
}

function applyModerationLearningHint(baseDecision, hint) {
  if (!hint) return baseDecision;

  const decision = { ...baseDecision };
  const detail = `learned:${hint.preferredStatus} (${hint.approvedCount}/${hint.pendingCount}/${hint.rejectedCount})`;

  if (
    hint.preferredStatus === 'rejected'
    && hint.rejectedCount >= 2
    && hint.confidence >= 0.55
  ) {
    if (decision.status === 'approved') {
      decision.status = 'pending';
      decision.moderationReason = '';
      decision.reviewNote = `${decision.reviewNote} | DJ feedback adjusted approved -> pending (${detail}).`;
      return decision;
    }
    if (decision.status === 'pending') {
      decision.status = 'rejected';
      decision.moderationReason = decision.moderationReason || 'other';
      decision.reviewNote = `${decision.reviewNote} | DJ feedback adjusted pending -> rejected (${detail}).`;
      return decision;
    }
  }

  if (
    hint.preferredStatus === 'approved'
    && hint.approvedCount >= 3
    && hint.confidence >= 0.7
    && decision.status === 'pending'
  ) {
    decision.status = 'approved';
    decision.moderationReason = '';
    decision.reviewNote = `${decision.reviewNote} | DJ feedback adjusted pending -> approved (${detail}).`;
    return decision;
  }

  decision.reviewNote = `${decision.reviewNote} | DJ feedback observed (${detail}).`;
  return decision;
}

async function fetchJsonWithTimeout(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonWithTimeout(url, payload, headers = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLyricsFromLyricsOvh(artistName, trackName) {
  const artist = normalizeArtistForLyrics(artistName);
  const title = normalizeTitleForLyrics(trackName);
  if (!artist || !title) return '';

  const url = `${LYRICS_OVH_BASE_URL}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const result = await fetchJsonWithTimeout(url, 3500);
  if (!result.ok) return '';

  const lyrics = sanitizeText(result.data?.lyrics || '', 30000);
  return lyrics;
}

async function fetchLyricsFromLrcLib(artistName, trackName) {
  const artist = normalizeArtistForLyrics(artistName);
  const title = normalizeTitleForLyrics(trackName);
  if (!artist || !title) return '';

  const params = new URLSearchParams();
  params.set('artist_name', artist);
  params.set('track_name', title);

  const url = `${LRCLIB_BASE_URL}?${params.toString()}`;
  const result = await fetchJsonWithTimeout(url, 3500);
  if (!result.ok) return '';

  const lyrics = sanitizeText(result.data?.plainLyrics || result.data?.syncedLyrics || '', 30000);
  return lyrics;
}

async function fetchLyricsForModeration(trackName, artists) {
  const artistCandidates = [];
  (artists || []).forEach((artist) => {
    const normalized = normalizeArtistForLyrics(artist);
    if (!normalized || artistCandidates.includes(normalized)) return;
    artistCandidates.push(normalized);
  });
  if (!artistCandidates.length) return { lyrics: '', provider: '' };

  const primaryArtist = artistCandidates[0];
  const titleCandidates = [];
  const rawTitle = sanitizeText(trackName, 200);
  const normalizedTitle = normalizeTitleForLyrics(rawTitle);
  if (rawTitle) titleCandidates.push(rawTitle);
  if (normalizedTitle && normalizedTitle !== rawTitle) titleCandidates.push(normalizedTitle);

  for (const title of titleCandidates.slice(0, 2)) {
    const lyricsFromOvh = await fetchLyricsFromLyricsOvh(primaryArtist, title);
    if (lyricsFromOvh) return { lyrics: lyricsFromOvh, provider: 'lyrics.ovh' };

    const lyricsFromLrcLib = await fetchLyricsFromLrcLib(primaryArtist, title);
    if (lyricsFromLrcLib) return { lyrics: lyricsFromLrcLib, provider: 'lrclib' };
  }

  return { lyrics: '', provider: '' };
}

function normalizeOpenAiCategoryMap(rawCategories) {
  const map = {};
  if (!rawCategories || typeof rawCategories !== 'object') return map;

  Object.entries(rawCategories).forEach(([key, value]) => {
    if (value === true) map[sanitizeText(key, 64)] = true;
  });

  return map;
}

function hasOpenAiCategory(categoryMap, categoryPrefix) {
  const safePrefix = sanitizeText(categoryPrefix, 64).toLowerCase();
  if (!safePrefix) return false;

  return Object.keys(categoryMap || {}).some((key) => {
    const normalized = sanitizeText(key, 64).toLowerCase();
    return normalized === safePrefix || normalized.startsWith(`${safePrefix}/`);
  });
}

function listOpenAiCategories(categoryMap) {
  return Object.keys(categoryMap || {}).map((key) => sanitizeText(key, 64)).filter(Boolean).sort();
}

async function checkContentWithOpenAiModeration(lyricsText, env) {
  const apiKey = sanitizeText(env?.OPENAI_API_KEY || '', 300);
  if (!apiKey) {
    return { available: false, flagged: false, categories: {}, failed: false };
  }

  const chunks = splitTextByLength(lyricsText, 1200).slice(0, 2);
  if (!chunks.length) {
    return { available: true, flagged: false, categories: {}, failed: false };
  }

  let anyFlagged = false;
  let anySuccess = false;
  const mergedCategories = {};

  for (const chunk of chunks) {
    const result = await postJsonWithTimeout(
      OPENAI_MODERATIONS_URL,
      { model: 'omni-moderation-latest', input: chunk },
      { Authorization: `Bearer ${apiKey}` },
      3200
    );
    if (!result.ok) continue;

    const moderation = result.data?.results?.[0];
    if (!moderation || typeof moderation !== 'object') continue;

    anySuccess = true;
    if (moderation.flagged === true) anyFlagged = true;

    const chunkCategories = normalizeOpenAiCategoryMap(moderation.categories);
    Object.keys(chunkCategories).forEach((key) => {
      mergedCategories[key] = true;
    });
  }

  return {
    available: true,
    flagged: anyFlagged,
    categories: mergedCategories,
    failed: !anySuccess
  };
}

function countLocalProfanityHits(lyricsText) {
  return LOCAL_PROFANITY_TERMS.reduce((total, term) => total + countKeywordHits(lyricsText, [term]), 0);
}

async function analyzeLyricsModeration(trackName, artists, env) {
  const lyricsResult = await fetchLyricsForModeration(trackName, artists);
  const lyrics = lyricsResult.lyrics;

  if (!lyrics) {
    return {
      foundLyrics: false,
      provider: '',
      profanityDetected: false,
      profanityHits: 0,
      openAiAvailable: Boolean(sanitizeText(env?.OPENAI_API_KEY || '', 300)),
      openAiFailed: false,
      openAiFlagged: false,
      openAiCategories: [],
      suggestiveHits: 0,
      alcoholHits: 0,
      drugHits: 0,
      violenceHits: 0,
      riskScore: 0,
      riskLevel: 'unknown'
    };
  }

  const suggestiveHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.suggestive);
  const alcoholHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.alcohol);
  const drugHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.drugs);
  const violenceHits = countKeywordHits(lyrics, LYRICS_MODERATION_HINT_TERMS.violence);

  const profanityHits = countLocalProfanityHits(lyrics);
  const localProfanityDetected = profanityHits > 0;
  const openAiResult = await checkContentWithOpenAiModeration(lyrics, env);
  const openAiCategories = listOpenAiCategories(openAiResult.categories);
  const openAiSexual = hasOpenAiCategory(openAiResult.categories, 'sexual');
  const openAiViolence = hasOpenAiCategory(openAiResult.categories, 'violence');
  const openAiHate = hasOpenAiCategory(openAiResult.categories, 'hate');
  const openAiIllicit = hasOpenAiCategory(openAiResult.categories, 'illicit');
  const openAiHarassment = hasOpenAiCategory(openAiResult.categories, 'harassment');

  const profanityDetected = localProfanityDetected;
  const profanityScore = Math.min(40, profanityHits * 10);
  const openAiScore = clampNumber(
    (openAiResult.flagged ? 18 : 0)
    + (openAiSexual ? 16 : 0)
    + (openAiViolence ? 18 : 0)
    + (openAiHate ? 22 : 0)
    + (openAiIllicit ? 14 : 0)
    + (openAiHarassment ? 10 : 0),
    0,
    65
  );

  const themeScore = Math.min(40, (suggestiveHits * 3) + (alcoholHits * 2) + (drugHits * 6) + (violenceHits * 5));
  const riskScore = clampNumber(profanityScore + themeScore + openAiScore, 0, 100);
  const riskLevel = riskScore >= 76 ? 'high' : riskScore >= 34 ? 'medium' : 'low';

  return {
    foundLyrics: true,
    provider: lyricsResult.provider,
    profanityDetected,
    profanityHits,
    openAiAvailable: openAiResult.available,
    openAiFailed: openAiResult.failed,
    openAiFlagged: openAiResult.flagged,
    openAiCategories,
    suggestiveHits,
    alcoholHits,
    drugHits,
    violenceHits,
    riskScore,
    riskLevel
  };
}

function chooseModerationReasonFromLyrics(lyricsAnalysis) {
  if (!lyricsAnalysis?.foundLyrics) return '';
  const openAiCategories = lyricsAnalysis.openAiCategories || [];
  if (openAiCategories.some((entry) => String(entry).startsWith('hate'))) return 'hate_speech';
  if (openAiCategories.some((entry) => String(entry).startsWith('violence'))) return 'violence';
  if (openAiCategories.some((entry) => String(entry).startsWith('sexual'))) return 'sexual_content';
  if (openAiCategories.some((entry) => String(entry).startsWith('illicit'))) return 'policy_violation';
  if ((lyricsAnalysis.profanityHits || 0) >= 2) return 'explicit_lyrics';
  if (lyricsAnalysis.profanityDetected) return 'other';
  if (lyricsAnalysis.drugHits > 0 || lyricsAnalysis.alcoholHits > 0) return 'policy_violation';
  if (lyricsAnalysis.violenceHits > 0) return 'violence';
  if (lyricsAnalysis.suggestiveHits > 0) return 'sexual_content';
  return '';
}

function buildLyricsReviewNote(baseScore, combinedScore, lyricsAnalysis, fallbackMessage) {
  if (!lyricsAnalysis?.foundLyrics) return fallbackMessage;

  const parts = [];
  parts.push(`Lyrics provider: ${lyricsAnalysis.provider || 'unknown'}`);
  parts.push(`risk=${lyricsAnalysis.riskLevel}/${lyricsAnalysis.riskScore}`);
  if (lyricsAnalysis.openAiAvailable) {
    parts.push(lyricsAnalysis.openAiFailed ? 'openai=failed' : 'openai=ok');
  } else {
    parts.push('openai=disabled');
  }
  if ((lyricsAnalysis.openAiCategories || []).length) {
    parts.push(`openai_categories:${lyricsAnalysis.openAiCategories.join(',')}`);
  }
  if (lyricsAnalysis.openAiFlagged) parts.push('openai_flagged');
  if (lyricsAnalysis.profanityDetected) parts.push(`profanity:${lyricsAnalysis.profanityHits || 1}`);
  if (lyricsAnalysis.suggestiveHits > 0) parts.push(`suggestive:${lyricsAnalysis.suggestiveHits}`);
  if (lyricsAnalysis.alcoholHits > 0) parts.push(`alcohol:${lyricsAnalysis.alcoholHits}`);
  if (lyricsAnalysis.drugHits > 0) parts.push(`drugs:${lyricsAnalysis.drugHits}`);
  if (lyricsAnalysis.violenceHits > 0) parts.push(`violence:${lyricsAnalysis.violenceHits}`);
  parts.push(`score ${baseScore} -> ${combinedScore}`);
  return parts.join(' | ');
}

async function getAutoModerationDecision({ trackName, artists, contentConfidence, env }) {
  const confidence = deriveContentConfidence(contentConfidence);
  const baseModerationScore = calculateModerationScore({ trackName, artists, contentConfidence: confidence });
  const strictSchoolMode = isSchoolSafeStrictMode(env);
  const blockedByTrackList = strictSchoolMode && isStrictBlockedTrack(trackName, env);
  const lyricsAnalysis = env?.DISABLE_LYRICS_MODERATION === '1'
    ? {
      foundLyrics: false,
      provider: '',
      profanityDetected: false,
      profanityHits: 0,
      openAiAvailable: false,
      openAiFailed: false,
      openAiFlagged: false,
      openAiCategories: [],
      suggestiveHits: 0,
      alcoholHits: 0,
      drugHits: 0,
      violenceHits: 0,
      riskScore: 0,
      riskLevel: 'unknown'
    }
    : await analyzeLyricsModeration(trackName, artists, env);
  const combinedScore = clampNumber(baseModerationScore - Math.round((lyricsAnalysis.riskScore || 0) * 0.65), 0, 100);
  const preferredReason = chooseModerationReasonFromLyrics(lyricsAnalysis) || (confidence === 'explicit' ? 'explicit_lyrics' : 'policy_violation');
  const trackExceptionMatched = isSafeTrackException(trackName, env);
  const openAiBackstopMissing = Boolean(
    lyricsAnalysis.foundLyrics
      && lyricsAnalysis.openAiAvailable
      && lyricsAnalysis.openAiFailed
      && !lyricsAnalysis.openAiFlagged
  );
  const strongProfanitySignal = strictSchoolMode
    ? (Number(lyricsAnalysis.profanityHits) || 0) >= 3
    : (Number(lyricsAnalysis.profanityHits) || 0) >= 6;
  const rejectScoreThreshold = strictSchoolMode
    ? (openAiBackstopMissing ? 22 : 30)
    : (openAiBackstopMissing ? 18 : 26);
  const highSeverityThemeSignal = (lyricsAnalysis.drugHits >= 2)
    || (lyricsAnalysis.alcoholHits >= 4)
    || (lyricsAnalysis.suggestiveHits >= 6)
    || (lyricsAnalysis.violenceHits >= 3);
  const severeRiskSignal = Boolean(
    lyricsAnalysis.openAiFlagged
    || strongProfanitySignal
    || lyricsAnalysis.drugHits >= 2
    || lyricsAnalysis.violenceHits >= 2
  );

  if (blockedByTrackList) {
    return {
      status: 'rejected',
      moderationReason: 'policy_violation',
      reviewNote: `Blocked by school safety blocklist for "${sanitizeText(trackName, 120)}".`,
      moderationScore: 0,
      hardBlocked: true
    };
  }

  if (trackExceptionMatched && confidence !== 'explicit') {
    const boostedScore = Math.max(combinedScore, 78);
    return {
      status: 'approved',
      moderationReason: 'clean_version_verified',
      reviewNote: buildLyricsReviewNote(
        baseModerationScore,
        boostedScore,
        lyricsAnalysis,
        `Safe-song exception matched for "${sanitizeText(trackName, 120)}".`
      ),
      moderationScore: boostedScore,
      hardBlocked: false
    };
  }

  if (
    confidence === 'explicit'
    || severeRiskSignal
    || strongProfanitySignal
    || combinedScore < rejectScoreThreshold
    || (strictSchoolMode && highSeverityThemeSignal)
  ) {
    return {
      status: 'rejected',
      moderationReason: preferredReason,
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-marked explicit by moderation (${combinedScore}).`),
      moderationScore: combinedScore,
      hardBlocked: false
    };
  }

  if (openAiBackstopMissing && (lyricsAnalysis.profanityDetected || lyricsAnalysis.riskLevel !== 'low')) {
    return {
      status: 'pending',
      moderationReason: '',
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `OpenAI fallback unavailable; manual review (${combinedScore}).`),
      moderationScore: combinedScore,
      hardBlocked: false
    };
  }

  if (lyricsAnalysis.riskLevel === 'medium' || lyricsAnalysis.profanityDetected) {
    return {
      status: 'pending',
      moderationReason: '',
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
      moderationScore: combinedScore,
      hardBlocked: false
    };
  }

  if (confidence === 'clean' && combinedScore >= (strictSchoolMode ? 82 : 70)) {
    return {
      status: 'approved',
      moderationReason: '',
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-approved to queue (${combinedScore}).`),
      moderationScore: combinedScore,
      hardBlocked: false
    };
  }

  return {
    status: 'pending',
    moderationReason: '',
    reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
    moderationScore: combinedScore,
    hardBlocked: false
  };
}

function normalizeDanceMoment(value) {
  const normalized = sanitizeText(value, 32).toLowerCase();
  if (!normalized) return 'anytime';
  return ALLOWED_DANCE_MOMENTS.includes(normalized) ? normalized : 'anytime';
}

function normalizeEnergyLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return clampNumber(Math.round(numeric), 1, 5);
}

function normalizeVibeTags(tags) {
  if (!Array.isArray(tags)) return [];

  const seen = new Set();
  const normalized = [];
  tags.forEach((tag) => {
    const entry = sanitizeText(tag, 32).toLowerCase();
    if (!ALLOWED_VIBE_TAGS.includes(entry) || seen.has(entry)) return;
    seen.add(entry);
    normalized.push(entry);
  });

  return normalized.slice(0, 5);
}
function parseArtists(rawArtists) {
  try {
    const parsed = JSON.parse(rawArtists || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((artist) => sanitizeText(artist, 120)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseRequesters(rawJson) {
  try {
    const parsed = JSON.parse(rawJson || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = sanitizeText(entry.name || '', 80);
      if (!name) return null;
      return {
        name,
        role: normalizeRole(entry.role),
        customMessage: sanitizeText(entry.customMessage || '', 500),
        submittedAt: sanitizeText(entry.submittedAt || '', 40),
        dedicationMessage: sanitizeText(entry.dedicationMessage || '', 140)
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function parseVibeTags(rawTags) {
  try {
    return normalizeVibeTags(JSON.parse(rawTags || '[]'));
  } catch {
    return [];
  }
}

function getHighestPriorityRole(requesterRoles) {
  return (requesterRoles || []).reduce((bestRole, role) => {
    const normalized = normalizeRole(role);
    const normalizedWeight = ROLE_WEIGHTS[normalized] || 0;
    const bestWeight = ROLE_WEIGHTS[bestRole] || 0;
    return normalizedWeight > bestWeight ? normalized : bestRole;
  }, 'guest');
}

function getPriorityTier(priorityScore) {
  if (priorityScore >= 72) return 'high';
  if (priorityScore >= 42) return 'medium';
  return 'low';
}

function chooseHigherPriorityEventDate(existingDate, incomingDate) {
  const current = normalizeIsoDate(existingDate);
  const incoming = normalizeIsoDate(incomingDate);
  if (!current) return incoming;
  if (!incoming) return current;
  return incoming < current ? incoming : current;
}

function chooseHigherPriorityDanceMoment(existingMoment, incomingMoment) {
  const current = normalizeDanceMoment(existingMoment);
  const incoming = normalizeDanceMoment(incomingMoment);
  const currentWeight = MOMENT_WEIGHTS[current] || 0;
  const incomingWeight = MOMENT_WEIGHTS[incoming] || 0;
  return incomingWeight > currentWeight ? incoming : current;
}

function mergeVibeTags(existingTags, incomingTags) {
  return normalizeVibeTags([...(existingTags || []), ...(incomingTags || [])]);
}

function calculatePriorityScore({ voteCount, requesterRoles, eventDate, contentConfidence, danceMoment, energyLevel }) {
  const safeVoteCount = Math.max(1, Number(voteCount) || 1);
  const voteScore = clampNumber(safeVoteCount * 6, 0, 40);

  const roleScore = (requesterRoles || []).reduce((maxScore, role) => {
    const weight = ROLE_WEIGHTS[normalizeRole(role)] || 0;
    return Math.max(maxScore, weight);
  }, ROLE_WEIGHTS.guest);

  let eventScore = 0;
  const normalizedDate = normalizeIsoDate(eventDate);
  if (normalizedDate) {
    const now = new Date();
    const eventAt = new Date(`${normalizedDate}T00:00:00.000Z`);
    const daysUntil = Math.ceil((eventAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 1) eventScore = 22;
    else if (daysUntil <= 3) eventScore = 17;
    else if (daysUntil <= 7) eventScore = 12;
    else if (daysUntil <= 14) eventScore = 8;
    else if (daysUntil <= 30) eventScore = 4;
    if (daysUntil < 0) eventScore = 0;
  }

  const confidence = deriveContentConfidence(contentConfidence);
  const confidenceScore = confidence === 'clean' ? 6 : confidence === 'explicit' ? -10 : 0;
  const momentScore = MOMENT_WEIGHTS[normalizeDanceMoment(danceMoment)] || MOMENT_WEIGHTS.anytime;
  const normalizedEnergy = normalizeEnergyLevel(energyLevel);
  const energyScore = (normalizedEnergy - 3) * 4;

  return clampNumber(Math.round(voteScore + roleScore + eventScore + confidenceScore + momentScore + energyScore), 0, 100);
}

function parseSetOrder(value) {
  if (value === null || value === undefined || value === '') return { valid: true, value: null };
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 9999) return { valid: false, value: null };
  return { valid: true, value: numeric };
}

function normalizeRequesterDisplayName(value) {
  return sanitizeText(String(value || '').replace(/\s+/g, ' '), 80).trim();
}

function normalizeRequesterMetricKey(value) {
  return normalizeRequesterDisplayName(value).toLowerCase();
}

function recordRequesterMetric(requesterStats, { name, status, submittedAt }) {
  const displayName = normalizeRequesterDisplayName(name);
  const key = normalizeRequesterMetricKey(displayName);
  if (!key) return;

  const existing = requesterStats.get(key) || {
    name: displayName,
    requestCount: 0,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    lastRequestedAt: ''
  };

  existing.requestCount += 1;
  if (status === 'approved') existing.approvedCount += 1;
  else if (status === 'pending') existing.pendingCount += 1;
  else if (status === 'rejected') existing.rejectedCount += 1;

  const submittedMs = parseIsoDateMs(submittedAt);
  const existingLastMs = parseIsoDateMs(existing.lastRequestedAt);
  if (submittedMs !== null && (existingLastMs === null || submittedMs >= existingLastMs)) {
    existing.lastRequestedAt = new Date(submittedMs).toISOString();
    existing.name = displayName || existing.name;
  } else if (!existing.name && displayName) {
    existing.name = displayName;
  }

  requesterStats.set(key, existing);
}

function normalizeSpotifySearchType(rawType) {
  const value = sanitizeText(rawType, 20).toLowerCase();
  if (value === 'track' || value === 'album' || value === 'artist') return value;
  return 'all';
}

function normalizeRequestRow(row) {
  const requesters = parseRequesters(row.requesters_json);
  const requesterName = sanitizeText(row.requester_name || '', 80);
  const requesterRole = normalizeRole(row.requester_role || 'guest');

  if (!requesters.length && requesterName) {
    requesters.push({
      name: requesterName,
      role: requesterRole,
      customMessage: sanitizeText(row.custom_message || '', 500),
      submittedAt: sanitizeText(row.submitted_at || '', 40),
      dedicationMessage: sanitizeText(row.dedication_message || '', 140)
    });
  }

  const voteCount = Math.max(1, Number(row.vote_count) || requesters.length || 1);
  const contentConfidence = deriveContentConfidence(row.content_confidence);
  const normalizedStatus = normalizeStatus(row.status) || 'pending';
  const reviewNote = sanitizeText(row.review_note || '', 500);
  const moderationReason = sanitizeText(row.moderation_reason || '', 64);
  const danceMoment = normalizeDanceMoment(row.dance_moment);
  const energyLevel = normalizeEnergyLevel(row.energy_level);
  const requesterRoles = requesters.map((entry) => entry.role);

  const priorityScore = Number.isFinite(Number(row.priority_score))
    ? Number(row.priority_score)
    : calculatePriorityScore({ voteCount, requesterRoles, eventDate: row.event_date, contentConfidence, danceMoment, energyLevel });

  const parsedSetOrder = parseSetOrder(row.set_order);
  const filterExplanation = buildFilterExplanation({
    status: normalizedStatus,
    moderationReason,
    reviewNote,
    contentConfidence
  });

  return {
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    artists: parseArtists(row.artists),
    albumName: row.album_name || '',
    albumImage: row.album_image || '',
    spotifyUrl: row.spotify_url || '',
    requesterName,
    requesterRole,
    requesters,
    customMessage: row.custom_message || '',
    dedicationMessage: row.dedication_message || '',
    eventDate: row.event_date || null,
    explicit: row.explicit_flag === null || row.explicit_flag === undefined ? null : Boolean(Number(row.explicit_flag)),
    contentConfidence,
    danceMoment,
    energyLevel,
    vibeTags: parseVibeTags(row.vibe_tags),
    moderationReason,
    voteCount,
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    status: normalizedStatus,
    reviewNote,
    filterSummary: buildFilterSummary({
      status: normalizedStatus,
      moderationReason,
      reviewNote,
      contentConfidence
    }),
    filterReasonLabel: filterExplanation.reasonLabel,
    filterReasonDetail: filterExplanation.detail,
    moderationReasonCode: filterExplanation.moderationReasonCode,
    djNotes: row.dj_notes || '',
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || null
  };
}

function projectPublicQueueItem(item) {
  return {
    id: item.id,
    trackId: item.trackId,
    trackName: item.trackName,
    artists: item.artists,
    albumName: item.albumName,
    albumImage: item.albumImage,
    spotifyUrl: item.spotifyUrl,
    dedicationMessage: item.dedicationMessage,
    contentConfidence: item.contentConfidence,
    danceMoment: item.danceMoment,
    energyLevel: item.energyLevel,
    vibeTags: item.vibeTags,
    voteCount: item.voteCount,
    priorityScore: item.priorityScore,
    priorityTier: item.priorityTier,
    setOrder: item.setOrder,
    status: item.status
  };
}

function buildDuplicateConflictPayloadFromRow(row) {
  const parsedSetOrder = parseSetOrder(row?.set_order);
  return {
    id: Number(row?.id || 0),
    trackId: sanitizeText(row?.track_id || '', 64),
    trackName: sanitizeText(row?.track_name || '', 200),
    status: normalizeStatus(row?.status) || 'pending',
    voteCount: Math.max(1, Number(row?.vote_count) || 1),
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null
  };
}

function getAdminCredentials(env) {
  const username = sanitizeText(env.DJ_USERNAME || env.ADMIN_USERNAME || '', 80);
  const password = sanitizeText(env.DJ_PASSWORD || env.ADMIN_PASSWORD || '', 120);
  if (!username || !password) return null;
  return { username, password };
}

function decodeBase64(value) {
  try {
    return atob(value);
  } catch {
    return '';
  }
}

function parseAuthorizationHeader(rawHeader) {
  const header = String(rawHeader || '').trim();
  if (!header) return { type: '', value: '' };
  const parts = header.split(/\s+/, 2);
  if (parts.length !== 2) return { type: '', value: '' };
  return { type: parts[0].toLowerCase(), value: parts[1] };
}

function isAdminAuthorized(request, env) {
  const credentials = getAdminCredentials(env);
  if (!credentials) return false;
  const parsed = parseAuthorizationHeader(request.headers.get('Authorization'));
  const expectedToken = btoa(`${credentials.username}:${credentials.password}`);

  if (parsed.type === 'basic') {
    const decoded = decodeBase64(parsed.value);
    return decoded === `${credentials.username}:${credentials.password}`;
  }

  if (parsed.type === 'bearer') {
    return parsed.value === expectedToken;
  }

  return false;
}

function unauthorizedResponse() {
  return json(
    { error: 'DJ authorization required', hint: 'Use DJ login first and send Authorization header.' },
    401,
    { 'WWW-Authenticate': 'Basic realm="Dance Admin"' }
  );
}

function adminCredentialsMissingResponse() {
  return json({ error: 'DJ credentials are not configured on this Worker.' }, 500);
}

function buildCreatePayload(body) {
  const trackId = sanitizeText(body.trackId, 64);
  const trackName = sanitizeText(body.trackName, 200);
  const artists = Array.isArray(body.artists)
    ? body.artists.map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 8)
    : [];

  const requesterName = sanitizeText(body.requesterName, 80);
  const requesterRole = normalizeRole(body.requesterRole);
  const customMessage = sanitizeText(body.customMessage, 500);
  const dedicationMessage = sanitizeText(body.dedicationMessage, 140);
  const eventDate = normalizeIsoDate(body.eventDate);

  const explicitFlag = typeof body.explicit === 'boolean' ? body.explicit : null;
  const contentConfidence = deriveContentConfidence(explicitFlag);
  const danceMoment = normalizeDanceMoment(body.danceMoment);
  const energyLevel = normalizeEnergyLevel(body.energyLevel);
  const vibeTags = normalizeVibeTags(body.vibeTags);

  return {
    trackId,
    trackName,
    artists,
    albumName: sanitizeText(body.albumName, 200),
    albumImage: sanitizeText(body.albumImage, 400),
    spotifyUrl: sanitizeText(body.spotifyUrl, 400),
    requesterName,
    requesterRole,
    customMessage,
    dedicationMessage,
    eventDate,
    explicitFlag,
    contentConfidence,
    danceMoment,
    energyLevel,
    vibeTags
  };
}

function buildRequesterEntry({ requesterName, requesterRole, customMessage, dedicationMessage, submittedAt }) {
  return {
    name: requesterName,
    role: requesterRole,
    customMessage: customMessage || '',
    dedicationMessage: dedicationMessage || '',
    submittedAt
  };
}

async function getMaxActiveSetOrder(env) {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(set_order), 0) AS max_order FROM requests WHERE status != 'rejected'").first();
  return Number(row?.max_order || 0);
}

async function renumberActiveQueue(env) {
  const rows = await env.DB.prepare(
    `SELECT id FROM requests
     WHERE status != 'rejected'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      id ASC`
  ).all();

  const ids = (rows.results || []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return;
  }

  await env.DB.batch(
    ids.map((id, index) =>
      env.DB.prepare('UPDATE requests SET set_order = ? WHERE id = ?').bind(index + 1, id)
    )
  );
}

async function reorderActiveQueue(env, itemId, beforeId) {
  const rows = await env.DB.prepare(
    `SELECT id FROM requests
     WHERE status != 'rejected'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      id ASC`
  ).all();

  const ids = (rows.results || []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.includes(itemId)) {
    return { ok: false, error: 'Item is not in the active queue' };
  }

  if (beforeId !== null && !ids.includes(beforeId)) {
    return { ok: false, error: 'Target position item not found in active queue' };
  }

  const nextIds = ids.filter((id) => id !== itemId);
  if (beforeId === null) {
    nextIds.push(itemId);
  } else {
    const insertIndex = nextIds.indexOf(beforeId);
    nextIds.splice(insertIndex, 0, itemId);
  }

  const now = new Date().toISOString();
  await env.DB.batch(
    nextIds.map((id, index) =>
      env.DB.prepare('UPDATE requests SET set_order = ?, updated_at = ? WHERE id = ?').bind(index + 1, now, id)
    )
  );

  return { ok: true };
}

async function ensureDjPlaybackTables(env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dj_playback_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dj_playback_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT,
        track_name TEXT NOT NULL,
        artists TEXT NOT NULL,
        album_image TEXT,
        spotify_url TEXT,
        played_by TEXT,
        played_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'dj'
      )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_dj_playback_history_played_at ON dj_playback_history(played_at DESC)')
  ]);
}

function sanitizePlaybackTrackPayload(payload) {
  const artists = Array.isArray(payload?.artists)
    ? payload.artists.map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 8)
    : [];
  return {
    trackId: sanitizeText(payload?.trackId || '', 64),
    trackName: sanitizeText(payload?.trackName || '', 200),
    artists,
    albumImage: sanitizeText(payload?.albumImage || '', 400),
    spotifyUrl: sanitizeText(payload?.spotifyUrl || '', 400),
    playedBy: sanitizeText(payload?.playedBy || '', 80) || 'DJ',
    source: sanitizeText(payload?.source || 'dj', 40) || 'dj',
    playedAt: sanitizeText(payload?.playedAt || '', 40)
  };
}

function buildPlaybackTrackFromQueueRow(row, { playedBy = 'DJ', source = 'dj' } = {}) {
  const item = normalizeRequestRow(row);
  return sanitizePlaybackTrackPayload({
    trackId: item.trackId,
    trackName: item.trackName,
    artists: item.artists,
    albumImage: item.albumImage,
    spotifyUrl: item.spotifyUrl,
    playedBy,
    source,
    playedAt: new Date().toISOString()
  });
}

async function setNowPlayingState(env, track) {
  await ensureDjPlaybackTables(env);
  const now = new Date().toISOString();
  const payload = sanitizePlaybackTrackPayload({ ...track, playedAt: track?.playedAt || now });
  await env.DB.prepare(
    `INSERT INTO dj_playback_state (state_key, state_value, updated_at)
     VALUES ('now_playing', ?, ?)
     ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(payload), now).run();
  return payload;
}

async function appendPlaybackHistory(env, track) {
  await ensureDjPlaybackTables(env);
  const payload = sanitizePlaybackTrackPayload({ ...track, playedAt: track?.playedAt || new Date().toISOString() });
  if (!payload.trackName || !payload.artists.length) return payload;
  await env.DB.prepare(
    `INSERT INTO dj_playback_history
      (track_id, track_name, artists, album_image, spotify_url, played_by, played_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    payload.trackId,
    payload.trackName,
    JSON.stringify(payload.artists),
    payload.albumImage,
    payload.spotifyUrl,
    payload.playedBy,
    payload.playedAt,
    payload.source
  ).run();
  return payload;
}

async function getDjPlaybackSnapshot(env, limit = 20) {
  await ensureDjPlaybackTables(env);
  const stateRow = await env.DB.prepare(
    "SELECT state_value, updated_at FROM dj_playback_state WHERE state_key = 'now_playing' LIMIT 1"
  ).first();
  let nowPlaying = null;
  try {
    nowPlaying = stateRow?.state_value ? JSON.parse(stateRow.state_value) : null;
  } catch {
    nowPlaying = null;
  }

  const historyRows = await env.DB.prepare(
    `SELECT * FROM dj_playback_history ORDER BY played_at DESC, id DESC LIMIT ?`
  ).bind(clampNumber(Number(limit) || 20, 1, 60)).all();

  const history = (historyRows.results || []).map((row) => ({
    id: Number(row.id || 0),
    trackId: sanitizeText(row.track_id || '', 64),
    trackName: sanitizeText(row.track_name || '', 200),
    artists: parseArtists(row.artists),
    albumImage: sanitizeText(row.album_image || '', 400),
    spotifyUrl: sanitizeText(row.spotify_url || '', 400),
    playedBy: sanitizeText(row.played_by || '', 80),
    playedAt: sanitizeText(row.played_at || '', 40),
    source: sanitizeText(row.source || '', 40)
  }));

  return { nowPlaying, history };
}

async function pinTrackToTop(env, itemId) {
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return { ok: false, error: 'Invalid item id' };
  }

  const existing = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  if (!existing) {
    return { ok: false, error: 'Queue item not found' };
  }
  if (existing.status === 'rejected') {
    return { ok: false, error: 'Explicit items cannot be pinned to queue.' };
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE requests
     SET status = 'approved', moderation_reason = '', set_order = 0, updated_at = ?, review_note = ?
     WHERE id = ?`
  ).bind(now, 'Pinned to top by DJ.', itemId).run();
  await recordModerationFeedback(env, {
    trackName: sanitizeText(existing.track_name || '', 200),
    artists: parseArtists(existing.artists),
    status: 'approved'
  });

  await renumberActiveQueue(env);
  return { ok: true, itemId };
}

async function runAdminControlAction(env, action, options = {}) {
  const now = new Date().toISOString();
  const normalizedAction = sanitizeText(action, 64).toLowerCase();

  if (normalizedAction === 'play_next_approved') {
    const nextApproved = await env.DB.prepare(
      `SELECT * FROM requests
       WHERE status = 'approved'
       ORDER BY
        CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
        set_order ASC,
        id ASC
       LIMIT 1`
    ).first();

    if (!nextApproved) {
      return { updatedCount: 0, action: normalizedAction };
    }

    const playbackTrack = buildPlaybackTrackFromQueueRow(nextApproved, {
      playedBy: sanitizeText(options.playedBy || '', 80) || 'DJ',
      source: 'play_next_approved'
    });
    await setNowPlayingState(env, playbackTrack);
    await appendPlaybackHistory(env, playbackTrack);

    await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(nextApproved.id).run();
    await renumberActiveQueue(env);
    return { updatedCount: 1, action: normalizedAction, playedItemId: Number(nextApproved.id), nowPlaying: playbackTrack };
  }

  if (normalizedAction === 'clear_all') {
    const result = await env.DB.prepare('DELETE FROM requests').run();
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }

  if (normalizedAction === 'clear_approved') {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'approved'").run();
    await renumberActiveQueue(env);
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }

  if (normalizedAction === 'clear_pending') {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'pending'").run();
    await renumberActiveQueue(env);
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }

  if (normalizedAction === 'clear_denied') {
    const result = await env.DB.prepare("DELETE FROM requests WHERE status = 'rejected'").run();
    return { updatedCount: Number(result.meta?.changes || 0), action: normalizedAction };
  }

  if (normalizedAction === 'renumber_active') {
    await renumberActiveQueue(env);
    return { updatedCount: 0, action: normalizedAction };
  }

  if (normalizedAction === 'pin_track') {
    const itemId = Number(options.itemId);
    const pinResult = await pinTrackToTop(env, itemId);
    if (!pinResult.ok) {
      return { updatedCount: 0, action: normalizedAction, error: pinResult.error || 'Unable to pin track' };
    }
    return { updatedCount: 1, action: normalizedAction, pinnedItemId: itemId };
  }

  return { updatedCount: 0, action: normalizedAction, error: 'Unsupported control action' };
}

function buildAnalyticsFromRows(rows) {
  const statusBreakdown = { pending: 0, approved: 0, rejected: 0 };
  const danceMomentBreakdown = new Map();
  const vibeTagBreakdown = new Map();
  const artistVotes = new Map();
  const trackVotes = new Map();
  const moderationReasonBreakdown = new Map();
  const requesterStats = new Map();

  let totalVotes = 0;
  let approvedVotes = 0;
  let weightedPrioritySum = 0;
  let weightedEnergySum = 0;
  let pendingHighPriority = 0;

  rows.forEach((row) => {
    const item = normalizeRequestRow(row);
    const votes = item.voteCount;

    totalVotes += votes;
    statusBreakdown[item.status] = (statusBreakdown[item.status] || 0) + votes;
    weightedPrioritySum += item.priorityScore * votes;
    weightedEnergySum += item.energyLevel * votes;

    if (item.status === 'approved') approvedVotes += votes;
    if (item.status === 'pending' && item.priorityTier === 'high') pendingHighPriority += votes;

    item.artists.forEach((artist) => artistVotes.set(artist, (artistVotes.get(artist) || 0) + votes));
    danceMomentBreakdown.set(item.danceMoment, (danceMomentBreakdown.get(item.danceMoment) || 0) + votes);
    item.vibeTags.forEach((tag) => vibeTagBreakdown.set(tag, (vibeTagBreakdown.get(tag) || 0) + votes));

    const trackKey = item.trackId || item.trackName;
    const existingTrack = trackVotes.get(trackKey) || { trackId: item.trackId, trackName: item.trackName, votes: 0, status: item.status };
    existingTrack.votes += votes;
    existingTrack.status = item.status;
    trackVotes.set(trackKey, existingTrack);

    if (item.status === 'rejected' && item.moderationReason) {
      moderationReasonBreakdown.set(item.moderationReason, (moderationReasonBreakdown.get(item.moderationReason) || 0) + votes);
    }

    const requesterEntries = Array.isArray(item.requesters) && item.requesters.length
      ? item.requesters
      : [{ name: item.requesterName, submittedAt: item.submittedAt }];

    requesterEntries.forEach((entry) => {
      recordRequesterMetric(requesterStats, {
        name: entry?.name || item.requesterName,
        status: item.status,
        submittedAt: entry?.submittedAt || item.submittedAt
      });
    });
  });

  const topRequestedArtists = [...artistVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([artist, votes]) => ({ artist, votes }));
  const topRequestedTracks = [...trackVotes.values()].sort((a, b) => b.votes - a.votes).slice(0, 10);
  const danceMoments = [...danceMomentBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([danceMoment, votes]) => ({ danceMoment, votes }));
  const vibeTags = [...vibeTagBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([tag, votes]) => ({ tag, votes }));
  const moderationReasons = [...moderationReasonBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  const topRequesters = [...requesterStats.values()]
    .sort((left, right) => {
      if (right.requestCount !== left.requestCount) return right.requestCount - left.requestCount;
      const leftTs = parseIsoDateMs(left.lastRequestedAt) || 0;
      const rightTs = parseIsoDateMs(right.lastRequestedAt) || 0;
      if (rightTs !== leftTs) return rightTs - leftTs;
      return String(left.name || '').localeCompare(String(right.name || ''));
    })
    .slice(0, 20);

  const approvalRate = totalVotes > 0 ? Number(((approvedVotes / totalVotes) * 100).toFixed(1)) : 0;
  const averagePriorityScore = totalVotes > 0 ? Number((weightedPrioritySum / totalVotes).toFixed(1)) : 0;
  const averageEnergyLevel = totalVotes > 0 ? Number((weightedEnergySum / totalVotes).toFixed(1)) : 0;

  return {
    totals: {
      requests: rows.length,
      votes: totalVotes,
      approvedVotes,
      approvalRate,
      averagePriorityScore,
      averageEnergyLevel,
      pendingHighPriority
    },
    statusBreakdown,
    topRequestedArtists,
    topRequestedTracks,
    topRequesters,
    danceMoments,
    vibeTags,
    moderationReasons
  };
}
async function handleGetPublicQueue(request, env) {
  const url = new URL(request.url);
  const status = sanitizeText(url.searchParams.get('status'), 20).toLowerCase();
  const limit = clampNumber(Number(url.searchParams.get('limit')) || 24, 1, 60);

  if (status && status !== 'approved') {
    return json({ error: 'Public queue only supports approved tracks.' }, 400);
  }

  const result = await env.DB.prepare(
    `SELECT * FROM requests
     WHERE status = 'approved'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      priority_score DESC,
      vote_count DESC,
      id DESC
     LIMIT ?`
  ).bind(limit).all();

  const items = (result.results || []).map(normalizeRequestRow).map(projectPublicQueueItem);
  return json({ items });
}

async function handleGetPublicFeed(env) {
  const approvedResult = await env.DB.prepare(
    `SELECT * FROM requests
     WHERE status = 'approved'
     ORDER BY
      CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
      set_order ASC,
      priority_score DESC,
      vote_count DESC,
      id DESC
     LIMIT 20`
  ).all();

  const allRows = await env.DB.prepare('SELECT * FROM requests').all();
  const analytics = buildAnalyticsFromRows(allRows.results || []);
  const upNext = (approvedResult.results || []).map(normalizeRequestRow).map(projectPublicQueueItem);

  return json({
    upNext,
    summary: {
      pendingVotes: Number(analytics.statusBreakdown.pending || 0),
      approvedVotes: Number(analytics.statusBreakdown.approved || 0),
      rejectedVotes: Number(analytics.statusBreakdown.rejected || 0),
      averageEnergyLevel: analytics.totals.averageEnergyLevel,
      approvalRate: analytics.totals.approvalRate
    },
    trendingArtists: analytics.topRequestedArtists.slice(0, 6),
    trendingMoments: analytics.danceMoments.slice(0, 6),
    trendingVibes: analytics.vibeTags.slice(0, 8)
  });
}

async function handleCreateRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const payload = buildCreatePayload(body || {});
  if (!payload.trackId || !payload.trackName || !payload.artists.length || !payload.requesterName) {
    return json({ error: 'Missing required fields' }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM requests WHERE track_id = ? AND status != 'rejected' ORDER BY id DESC LIMIT 1"
  ).bind(payload.trackId).first();

  if (existing) {
    return json({
      error: 'This song is already in queue/review and cannot be requested again right now.',
      code: 'duplicate_active',
      existing: buildDuplicateConflictPayloadFromRow(existing)
    }, 409);
  }

  const isDjAuthorizedRequest = isAdminAuthorized(request, env);
  const isEvalBypassRequest = request.headers.get('X-Eval-Bypass') === '1' && isDjAuthorizedRequest;
  const shouldBypassRateLimit = isDjAuthorizedRequest || isEvalBypassRequest;
  let limitResult = { allowed: true, retryAfterSec: Math.ceil(REQUEST_LIMIT_WINDOW_MS / 1000), nextAllowedAt: '' };
  if (!shouldBypassRateLimit) {
    const clientIp = getClientIp(request);
    limitResult = await checkAndConsumeRateLimit(env, clientIp);
    if (!limitResult.allowed) {
      return json({
        error: 'You can request one song every 10 minutes from this device/network.',
        retryAfterSec: limitResult.retryAfterSec,
        nextAllowedAt: limitResult.nextAllowedAt
      }, 429, { 'Retry-After': String(limitResult.retryAfterSec) });
    }
  }

  const now = new Date().toISOString();
  const requesters = [buildRequesterEntry({
    requesterName: payload.requesterName,
    requesterRole: payload.requesterRole,
    customMessage: payload.customMessage,
    dedicationMessage: payload.dedicationMessage,
    submittedAt: now
  })];

  const priorityScore = calculatePriorityScore({
    voteCount: 1,
    requesterRoles: [payload.requesterRole],
    eventDate: payload.eventDate,
    contentConfidence: payload.contentConfidence,
    danceMoment: payload.danceMoment,
    energyLevel: payload.energyLevel
  });

  let autoDecision = await getAutoModerationDecision({
    trackName: payload.trackName,
    artists: payload.artists,
    contentConfidence: payload.contentConfidence,
    env
  });
  if (isDjAuthorizedRequest && autoDecision.status !== 'rejected') {
    autoDecision = {
      ...autoDecision,
      status: 'approved',
      moderationReason: '',
      reviewNote: `Added directly to queue by DJ (${sanitizeText(payload.requesterName, 80)}).`
    };
  } else if (isDjAuthorizedRequest && autoDecision.status === 'rejected') {
    autoDecision = {
      ...autoDecision,
      reviewNote: `${autoDecision.reviewNote} | DJ quick-add blocked by strict school policy.`
    };
  } else {
    const learningHint = await getModerationLearningHint(env, {
      trackName: payload.trackName,
      artists: payload.artists
    });
    autoDecision = applyModerationLearningHint(autoDecision, learningHint);
  }
  const nextSetOrder = autoDecision.status === 'rejected' ? null : (await getMaxActiveSetOrder(env)) + 1;

  const insert = await env.DB.prepare(
    `INSERT INTO requests
      (track_id, track_name, artists, album_name, album_image, spotify_url,
       requester_name, requester_role, custom_message, dedication_message,
       event_date, explicit_flag, content_confidence, dance_moment, energy_level, vibe_tags,
       vote_count, requesters_json, priority_score, status, review_note, moderation_reason, dj_notes, set_order, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).bind(
    payload.trackId,
    payload.trackName,
    JSON.stringify(payload.artists),
    payload.albumName,
    payload.albumImage,
    payload.spotifyUrl,
    payload.requesterName,
    payload.requesterRole,
    payload.customMessage,
    payload.dedicationMessage,
    payload.eventDate,
    payload.explicit === null ? null : payload.explicit ? 1 : 0,
    payload.contentConfidence,
    payload.danceMoment,
    payload.energyLevel,
    JSON.stringify(payload.vibeTags),
    1,
    JSON.stringify(requesters),
    priorityScore,
    autoDecision.status,
    autoDecision.reviewNote,
    autoDecision.moderationReason,
    nextSetOrder,
    now
  ).run();

  const created = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(insert.meta.last_row_id).first();
  return json({
    ...normalizeRequestRow(created),
    retryAfterSec: limitResult.retryAfterSec,
    nextAllowedAt: limitResult.nextAllowedAt || new Date(Date.now() + REQUEST_LIMIT_WINDOW_MS).toISOString()
  }, 201);
}
async function handleAdminLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const credentials = getAdminCredentials(env);
  if (!credentials) return adminCredentialsMissingResponse();
  const username = sanitizeText(body.username, 80);
  const password = sanitizeText(body.password, 120);

  if (username !== credentials.username || password !== credentials.password) {
    return json({ error: 'Invalid DJ credentials' }, 401);
  }

  return json({ ok: true, username: credentials.username, tokenType: 'Basic', token: btoa(`${credentials.username}:${credentials.password}`) });
}

async function handleAdminSession(request, env) {
  const credentials = getAdminCredentials(env);
  if (!credentials) return adminCredentialsMissingResponse();
  if (!isAdminAuthorized(request, env)) return unauthorizedResponse();
  return json({ ok: true, username: credentials.username });
}

async function handleAdminGetQueue(request, env) {
  const url = new URL(request.url);
  const status = sanitizeText(url.searchParams.get('status'), 20).toLowerCase();
  const confidence = sanitizeText(url.searchParams.get('confidence'), 20).toLowerCase();
  const danceMoment = sanitizeText(url.searchParams.get('danceMoment'), 32).toLowerCase();
  const search = sanitizeText(url.searchParams.get('q'), 80).toLowerCase();

  if (status && !ALLOWED_STATUSES.includes(status)) return json({ error: 'Invalid status filter' }, 400);
  if (confidence && !ALLOWED_CONFIDENCE.includes(confidence)) return json({ error: 'Invalid confidence filter' }, 400);
  if (danceMoment && !ALLOWED_DANCE_MOMENTS.includes(danceMoment)) return json({ error: 'Invalid dance moment filter' }, 400);

  const clauses = [];
  const params = [];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (confidence) {
    clauses.push('content_confidence = ?');
    params.push(confidence);
  }
  if (danceMoment) {
    clauses.push('dance_moment = ?');
    params.push(danceMoment);
  }
  if (search) {
    const wildcard = `%${search}%`;
    clauses.push('(LOWER(track_name) LIKE ? OR LOWER(artists) LIKE ? OR LOWER(requester_name) LIKE ?)');
    params.push(wildcard, wildcard, wildcard);
  }

  let query = 'SELECT * FROM requests';
  if (clauses.length) query += ` WHERE ${clauses.join(' AND ')}`;
  query += ` ORDER BY
    CASE WHEN status = 'rejected' THEN 1 ELSE 0 END,
    CASE WHEN set_order IS NULL THEN 1 ELSE 0 END,
    set_order ASC,
    id ASC`;

  const stmt = env.DB.prepare(query);
  const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
  return json({ items: (result.results || []).map(normalizeRequestRow) });
}

async function handleAdminUpdateQueue(request, env, rawId) {
  const itemId = Number(rawId);
  if (!Number.isInteger(itemId) || itemId <= 0) return json({ error: 'Invalid queue item id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  if (!existing) return json({ error: 'Queue item not found' }, 404);

  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const hasReviewNote = Object.prototype.hasOwnProperty.call(body, 'reviewNote');
  const hasModerationReason = Object.prototype.hasOwnProperty.call(body, 'moderationReason');
  const hasDanceMoment = Object.prototype.hasOwnProperty.call(body, 'danceMoment');
  const hasEnergyLevel = Object.prototype.hasOwnProperty.call(body, 'energyLevel');
  const hasDjNotes = Object.prototype.hasOwnProperty.call(body, 'djNotes');
  const hasSetOrder = Object.prototype.hasOwnProperty.call(body, 'setOrder');

  if (!hasStatus && !hasReviewNote && !hasModerationReason && !hasDanceMoment && !hasEnergyLevel && !hasDjNotes && !hasSetOrder) {
    return json({ error: 'No DJ updates were provided' }, 400);
  }

  const status = hasStatus ? normalizeStatus(body.status) : normalizeStatus(existing.status);
  if (!status) return json({ error: 'Invalid status value' }, 400);

  const moderationReason = hasModerationReason ? normalizeModerationReason(body.moderationReason) : sanitizeText(existing.moderation_reason || '', 64);
  if (moderationReason === null) return json({ error: 'Invalid moderation reason preset' }, 400);

  let resolvedModerationReason = moderationReason || '';
  if (status === 'rejected' && !resolvedModerationReason) resolvedModerationReason = sanitizeText(existing.moderation_reason || '', 64);
  if (status === 'rejected' && !resolvedModerationReason) return json({ error: 'Choose a moderation preset when rejecting a track' }, 400);
  if (status !== 'rejected' && !hasModerationReason) resolvedModerationReason = '';

  const reviewNote = hasReviewNote ? sanitizeText(body.reviewNote, 500) : sanitizeText(existing.review_note || '', 500);
  const danceMoment = hasDanceMoment ? normalizeDanceMoment(body.danceMoment) : normalizeDanceMoment(existing.dance_moment);
  const energyLevel = hasEnergyLevel ? normalizeEnergyLevel(body.energyLevel) : normalizeEnergyLevel(existing.energy_level);
  const djNotes = hasDjNotes ? sanitizeText(body.djNotes, 500) : sanitizeText(existing.dj_notes || '', 500);

  const previousStatus = normalizeStatus(existing.status) || 'pending';
  const parsedSetOrder = hasSetOrder ? parseSetOrder(body.setOrder) : parseSetOrder(existing.set_order);
  if (!parsedSetOrder.valid) return json({ error: 'Invalid set order value' }, 400);
  let resolvedSetOrder = parsedSetOrder.value;

  if (status === 'rejected') {
    resolvedSetOrder = null;
  } else {
    const maxOrder = await getMaxActiveSetOrder(env);
    if (previousStatus === 'rejected') {
      resolvedSetOrder = resolvedSetOrder === null ? maxOrder + 1 : resolvedSetOrder;
    } else if (resolvedSetOrder === null) {
      const existingSetOrder = parseSetOrder(existing.set_order);
      resolvedSetOrder = existingSetOrder.valid ? existingSetOrder.value : maxOrder + 1;
    }
  }

  const requesters = parseRequesters(existing.requesters_json);
  const requesterRoles = requesters.length ? requesters.map((entry) => entry.role) : [normalizeRole(existing.requester_role)];
  const voteCount = Math.max(1, Number(existing.vote_count) || 1);

  const priorityScore = calculatePriorityScore({
    voteCount,
    requesterRoles,
    eventDate: existing.event_date,
    contentConfidence: existing.content_confidence,
    danceMoment,
    energyLevel
  });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE requests
     SET status = ?, review_note = ?, moderation_reason = ?, dance_moment = ?, energy_level = ?, dj_notes = ?, set_order = ?, priority_score = ?, updated_at = ?
     WHERE id = ?`
  ).bind(status, reviewNote, resolvedModerationReason, danceMoment, energyLevel, djNotes, resolvedSetOrder, priorityScore, now, itemId).run();

  if (hasStatus && previousStatus !== status) {
    await recordModerationFeedback(env, {
      trackName: sanitizeText(existing.track_name || '', 200),
      artists: parseArtists(existing.artists),
      status
    });
  }

  await renumberActiveQueue(env);

  const updated = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  return json(normalizeRequestRow(updated));
}

async function handleAdminDeleteQueueItem(env, rawId) {
  const itemId = Number(rawId);
  if (!Number.isInteger(itemId) || itemId <= 0) return json({ error: 'Invalid queue item id' }, 400);

  const existing = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  if (!existing) return json({ error: 'Queue item not found' }, 404);

  await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(itemId).run();
  await renumberActiveQueue(env);

  return json({
    ok: true,
    deletedId: itemId,
    trackName: sanitizeText(existing.track_name || '', 200),
    status: normalizeStatus(existing.status) || 'pending'
  });
}

async function handleAdminBulkAction(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const action = sanitizeText(body.action, 64).toLowerCase();
  const limit = clampNumber(Number(body.limit) || 8, 1, 40);
  const now = new Date().toISOString();

  if (action === 'approve_clean_high_priority') {
    const found = await env.DB.prepare(
      `SELECT id FROM requests
       WHERE status = 'pending' AND content_confidence = 'clean' AND priority_score >= 55
       ORDER BY priority_score DESC, vote_count DESC, id DESC
       LIMIT ?`
    ).bind(limit).all();

    const ids = (found.results || []).map((entry) => entry.id);
    if (!ids.length) return json({ updatedCount: 0, updatedIds: [] });

    await env.DB.batch(ids.map((id) =>
      env.DB.prepare(`UPDATE requests SET status = 'approved', moderation_reason = '', review_note = ?, updated_at = ? WHERE id = ?`)
        .bind('Bulk-approved clean/high-priority request.', now, id)
    ));

    return json({ updatedCount: ids.length, updatedIds: ids });
  }

  if (action === 'reject_explicit') {
    const found = await env.DB.prepare(
      `SELECT id FROM requests
       WHERE status = 'pending' AND content_confidence = 'explicit'
       ORDER BY priority_score DESC, vote_count DESC, id DESC
       LIMIT ?`
    ).bind(limit).all();

    const ids = (found.results || []).map((entry) => entry.id);
    if (!ids.length) return json({ updatedCount: 0, updatedIds: [] });

    await env.DB.batch(ids.map((id) =>
      env.DB.prepare(`UPDATE requests SET status = 'rejected', moderation_reason = 'explicit_lyrics', review_note = ?, updated_at = ? WHERE id = ?`)
        .bind('Bulk-rejected explicit track.', now, id)
    ));

    return json({ updatedCount: ids.length, updatedIds: ids });
  }

  return json({ error: 'Unsupported bulk action' }, 400);
}

async function handleAdminReorder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const itemId = Number(body.itemId);
  const beforeId = body.beforeId === null || body.beforeId === undefined ? null : Number(body.beforeId);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return json({ error: 'Invalid item id' }, 400);
  }

  if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId <= 0)) {
    return json({ error: 'Invalid before id' }, 400);
  }

  const result = await reorderActiveQueue(env, itemId, beforeId);
  if (!result.ok) {
    return json({ error: result.error || 'Unable to reorder queue' }, 400);
  }

  return json({ ok: true });
}

async function handleAdminControl(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const action = sanitizeText(body.action, 64).toLowerCase();
  if (!action) {
    return json({ error: 'Control action is required' }, 400);
  }

  const result = await runAdminControlAction(env, action, {
    itemId: body.itemId,
    playedBy: sanitizeText(body.playedBy, 80) || 'DJ'
  });
  if (result.error) {
    return json({ error: result.error }, 400);
  }

  return json(result);
}

async function handleGetAdminAnalytics(env) {
  const result = await env.DB.prepare('SELECT * FROM requests').all();
  return json(buildAnalyticsFromRows(result.results || []));
}

async function handleGetDjPlayback(env, request) {
  const url = new URL(request.url);
  const limit = clampNumber(Number(url.searchParams.get('limit')) || 20, 1, 60);
  const snapshot = await getDjPlaybackSnapshot(env, limit);
  return json(snapshot);
}

async function handleSetDjNowPlaying(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const track = sanitizePlaybackTrackPayload({
    trackId: body.trackId,
    trackName: body.trackName,
    artists: body.artists,
    albumImage: body.albumImage,
    spotifyUrl: body.spotifyUrl,
    playedBy: sanitizeText(body.playedBy, 80) || 'DJ',
    source: sanitizeText(body.source, 40) || 'dj_manual',
    playedAt: new Date().toISOString()
  });

  if (!track.trackName || !track.artists.length) {
    return json({ error: 'Track name and artists are required' }, 400);
  }

  const nowPlaying = await setNowPlayingState(env, track);
  return json({ ok: true, nowPlaying });
}

async function handleMarkDjPlaybackHistory(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const track = sanitizePlaybackTrackPayload({
    trackId: body.trackId,
    trackName: body.trackName,
    artists: body.artists,
    albumImage: body.albumImage,
    spotifyUrl: body.spotifyUrl,
    playedBy: sanitizeText(body.playedBy, 80) || 'DJ',
    source: sanitizeText(body.source, 40) || 'dj_manual',
    playedAt: new Date().toISOString()
  });

  if (!track.trackName || !track.artists.length) {
    return json({ error: 'Track name and artists are required' }, 400);
  }

  await setNowPlayingState(env, track);
  await appendPlaybackHistory(env, track);
  return json({ ok: true });
}

function normalizeSoundCloudMatchText(value) {
  const lowered = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return sanitizeText(lowered, 280).replace(/\s+/g, ' ').trim();
}

function tokenizeSoundCloudMatchText(value) {
  const normalized = normalizeSoundCloudMatchText(value);
  return normalized ? normalized.split(' ') : [];
}

function soundCloudContainsWholePhrase(haystack, phrase) {
  const normalizedHaystack = normalizeSoundCloudMatchText(haystack);
  const normalizedPhrase = normalizeSoundCloudMatchText(phrase);
  if (!normalizedHaystack || !normalizedPhrase) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedPhrase} `);
}

function hasLikelySoundCloudVariantMarkers(title) {
  const normalized = normalizeSoundCloudMatchText(title);
  if (!normalized) return false;
  const markers = [
    'karaoke',
    'instrumental',
    'cover',
    'tribute',
    'nightcore',
    'sped up',
    'slowed',
    'reverb',
    'remix',
    'edit',
    'mashup'
  ];
  return markers.some((marker) => normalized.includes(marker));
}

function getMeaningfulSoundCloudTokens(value) {
  const stop = new Set(['the', 'and', 'feat', 'ft', 'official', 'audio', 'video', 'lyrics', 'music', 'remix', 'edit', 'version']);
  return tokenizeSoundCloudMatchText(value)
    .map((token) => sanitizeText(token, 40))
    .filter((token) => token && token.length >= 3 && !stop.has(token));
}

function computeSoundCloudTokenCoverage(requiredTokens, candidateTokens) {
  if (!requiredTokens.length) return 1;
  if (!candidateTokens.size) return 0;
  let hits = 0;
  requiredTokens.forEach((token) => {
    if (candidateTokens.has(token)) hits += 1;
  });
  return hits / requiredTokens.length;
}

function buildSoundCloudCandidateSignals({ trackName, artists, candidateTitle, candidateArtist }) {
  const titleNorm = normalizeSoundCloudMatchText(trackName);
  const candidateTitleNorm = normalizeSoundCloudMatchText(candidateTitle);
  const primaryArtist = sanitizeText((artists || [])[0] || '', 120);
  const primaryArtistNorm = normalizeSoundCloudMatchText(primaryArtist);
  const candidateArtistNorm = normalizeSoundCloudMatchText(candidateArtist);

  const titleTokens = getMeaningfulSoundCloudTokens(trackName);
  const candidateTitleTokens = new Set(getMeaningfulSoundCloudTokens(candidateTitle));
  const primaryArtistTokens = getMeaningfulSoundCloudTokens(primaryArtist);
  const candidateCompositeTokens = new Set(getMeaningfulSoundCloudTokens(`${candidateArtist} ${candidateTitle}`));

  const titleCoverage = computeSoundCloudTokenCoverage(titleTokens, candidateTitleTokens);
  const artistCoverage = computeSoundCloudTokenCoverage(primaryArtistTokens, candidateCompositeTokens);
  const exactTitleFamilyMatch = Boolean(titleNorm && candidateTitleNorm && (
    candidateTitleNorm === titleNorm
    || candidateTitleNorm.includes(titleNorm)
    || titleNorm.includes(candidateTitleNorm)
  ));
  const titleMatched = exactTitleFamilyMatch || titleCoverage >= 0.72;
  const artistMatched = !primaryArtistTokens.length || artistCoverage >= 0.7 || (
    primaryArtistNorm && candidateArtistNorm && (
      candidateArtistNorm.includes(primaryArtistNorm)
      || primaryArtistNorm.includes(candidateArtistNorm)
    )
  );
  const artistStrictMatched = !primaryArtist || soundCloudContainsWholePhrase(candidateArtist, primaryArtist);

  return {
    titleCoverage,
    artistCoverage,
    titleMatched,
    artistMatched,
    artistStrictMatched,
    acceptable: titleMatched && artistMatched && artistStrictMatched
  };
}

function computeSoundCloudMatchScore({ trackName, artists, candidateTitle, candidateArtist }) {
  const titleNorm = normalizeSoundCloudMatchText(trackName);
  const candidateTitleNorm = normalizeSoundCloudMatchText(candidateTitle);
  const primaryArtistNorm = normalizeSoundCloudMatchText((artists || [])[0] || '');
  const candidateArtistNorm = normalizeSoundCloudMatchText(candidateArtist);

  const titleTokens = tokenizeSoundCloudMatchText(trackName);
  const candidateTitleTokens = new Set(tokenizeSoundCloudMatchText(candidateTitle));
  const artistTokens = tokenizeSoundCloudMatchText((artists || []).join(' '));
  const candidateArtistTokens = new Set(tokenizeSoundCloudMatchText(candidateArtist));

  let score = 0;

  if (titleNorm && candidateTitleNorm) {
    if (candidateTitleNorm === titleNorm) score += 100;
    if (candidateTitleNorm.startsWith(titleNorm)) score += 50;
    if (candidateTitleNorm.includes(titleNorm)) score += 28;
    if (titleNorm.includes(candidateTitleNorm)) score += 14;
  }

  if (primaryArtistNorm && candidateArtistNorm) {
    if (candidateArtistNorm === primaryArtistNorm) score += 32;
    else if (candidateArtistNorm.includes(primaryArtistNorm)) score += 20;
    else if (primaryArtistNorm.includes(candidateArtistNorm)) score += 10;
  }

  titleTokens.forEach((token) => {
    if (candidateTitleTokens.has(token)) score += 4;
  });
  artistTokens.forEach((token) => {
    if (candidateArtistTokens.has(token)) score += 3;
  });

  const signals = buildSoundCloudCandidateSignals({ trackName, artists, candidateTitle, candidateArtist });
  score += Math.round(signals.titleCoverage * 50);
  score += Math.round(signals.artistCoverage * 40);
  if (signals.artistStrictMatched) score += 60;
  if (signals.acceptable) score += 45;
  if (hasLikelySoundCloudVariantMarkers(candidateTitle)) score -= 55;

  return score;
}

function mapSoundCloudTrack(track, { trackName, artists }) {
  const id = Number(track?.id || 0);
  const title = sanitizeText(track?.title || '', 220);
  const uploaderName = sanitizeText(track?.user?.username || '', 120);
  const publisherArtist = sanitizeText(track?.publisher_metadata?.artist || '', 120);
  const artist = sanitizeText(publisherArtist || uploaderName, 120);
  const permalinkUrl = sanitizeText(track?.permalink_url || '', 400);
  if (!id || !title || !permalinkUrl) return null;

  const durationMs = Math.max(0, Number(track?.duration || track?.full_duration || 0));
  const artworkUrl = sanitizeText(track?.artwork_url || track?.user?.avatar_url || '', 400);
  const artistComposite = sanitizeText(`${uploaderName} ${publisherArtist}`.trim(), 240);
  const signals = buildSoundCloudCandidateSignals({ trackName, artists, candidateTitle: title, candidateArtist: artistComposite || artist });
  const primaryArtist = sanitizeText((artists || [])[0] || '', 120);
  const uploaderVerified = Boolean(track?.user?.verified || track?.verified);
  const publisherStrictArtistMatch = !primaryArtist || soundCloudContainsWholePhrase(publisherArtist, primaryArtist);
  const officialLikeArtistMatch = !primaryArtist || uploaderVerified || publisherStrictArtistMatch;
  const variantLikely = hasLikelySoundCloudVariantMarkers(title);

  return {
    id,
    title,
    artist,
    uploaderName,
    publisherArtist,
    uploaderVerified,
    officialLikeArtistMatch,
    durationMs,
    artworkUrl,
    permalinkUrl,
    apiTrackUrl: `https://api.soundcloud.com/tracks/${id}`,
    matchScore: computeSoundCloudMatchScore({
      trackName,
      artists,
      candidateTitle: title,
      candidateArtist: artistComposite || artist
    }),
    titleCoverage: signals.titleCoverage,
    artistCoverage: signals.artistCoverage,
    titleMatched: signals.titleMatched,
    artistMatched: signals.artistMatched,
    artistStrictMatched: signals.artistStrictMatched,
    variantLikely,
    acceptable: signals.acceptable
  };
}

function buildSoundCloudWidgetSrc(apiTrackUrl) {
  const params = new URLSearchParams({
    url: apiTrackUrl,
    auto_play: 'true',
    hide_related: 'true',
    show_comments: 'false',
    show_user: 'true',
    show_reposts: 'false',
    visual: 'false'
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

function buildSoundCloudSearchQuery(trackName, artists) {
  const parts = [sanitizeText(trackName, 220), ...(artists || []).map((artist) => sanitizeText(artist, 120))]
    .filter(Boolean)
    .slice(0, 3);
  return sanitizeText(parts.join(' '), 320);
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function sanitizeSoundCloudErrorDetail(value) {
  return sanitizeText(String(value || ''), 220);
}

async function requestSoundCloudClientToken(clientId, clientSecret) {
  const tokenUrls = [SOUND_CLOUD_OAUTH_TOKEN_URL, SOUND_CLOUD_OAUTH_TOKEN_FALLBACK_URL];
  let lastStatus = 500;
  let lastDetail = '';

  for (const tokenUrl of tokenUrls) {
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        body: 'grant_type=client_credentials'
      });

      if (response.ok) {
        const tokenPayload = await parseJsonSafe(response);
        const accessToken = sanitizeText(tokenPayload?.access_token || '', 500);
        if (accessToken) return { token: accessToken, status: 200, detail: '' };
      }

      lastStatus = Number(response.status) || 500;
      const body = await parseJsonSafe(response);
      lastDetail = sanitizeSoundCloudErrorDetail(body?.error_description || body?.error || body?.message || '');
    } catch (error) {
      lastStatus = 502;
      const diagnostic = sanitizeSoundCloudErrorDetail(error?.message || error?.cause?.message || String(error || ''));
      lastDetail = diagnostic || 'token_request_failed';
    }
  }

  return {
    token: '',
    status: lastStatus,
    detail: lastDetail || 'unable_to_retrieve_access_token'
  };
}

async function fetchSoundCloudTracks({ query, clientId, accessToken }) {
  const tracksUrl = new URL(SOUND_CLOUD_TRACKS_BASE_URL);
  tracksUrl.searchParams.set('q', query);
  tracksUrl.searchParams.set('limit', '30');
  tracksUrl.searchParams.set('linked_partitioning', '1');
  if (clientId) tracksUrl.searchParams.set('client_id', clientId);

  const searchV2Url = new URL(SOUND_CLOUD_SEARCH_V2_URL);
  searchV2Url.searchParams.set('q', query);
  searchV2Url.searchParams.set('limit', '30');
  searchV2Url.searchParams.set('offset', '0');
  searchV2Url.searchParams.set('linked_partitioning', '1');
  if (clientId) searchV2Url.searchParams.set('client_id', clientId);

  const requestAttempts = [];
  if (accessToken) {
    requestAttempts.push({ label: 'tracks_bearer', url: tracksUrl.toString(), authHeader: `Bearer ${accessToken}` });
    requestAttempts.push({ label: 'tracks_oauth', url: tracksUrl.toString(), authHeader: `OAuth ${accessToken}` });
    requestAttempts.push({ label: 'search_v2_bearer', url: searchV2Url.toString(), authHeader: `Bearer ${accessToken}` });
    requestAttempts.push({ label: 'search_v2_oauth', url: searchV2Url.toString(), authHeader: `OAuth ${accessToken}` });
  }
  if (clientId) {
    requestAttempts.push({ label: 'tracks_client_id', url: tracksUrl.toString(), authHeader: '' });
    requestAttempts.push({ label: 'search_v2_client_id', url: searchV2Url.toString(), authHeader: '' });
  }

  if (!requestAttempts.length) {
    return { ok: false, status: 500, detail: 'no_auth_credentials', collection: [] };
  }

  let lastStatus = 500;
  let lastDetail = '';
  let lastEndpoint = '';

  for (const attempt of requestAttempts) {
    const requestUrl = attempt.url;
    const headers = { Accept: 'application/json' };
    if (attempt.authHeader) headers.Authorization = attempt.authHeader;

    try {
      const response = await fetch(requestUrl, { headers });
      if (response.ok) {
        const body = await parseJsonSafe(response);
        const collection = Array.isArray(body) ? body : (Array.isArray(body?.collection) ? body.collection : []);
        return { ok: true, status: response.status, detail: '', collection };
      }

      lastEndpoint = attempt.label || 'unknown';
      lastStatus = Number(response.status) || 500;
      const body = await parseJsonSafe(response);
      lastDetail = sanitizeSoundCloudErrorDetail(body?.error_description || body?.error || body?.message || '');
    } catch (error) {
      lastEndpoint = attempt.label || 'unknown';
      lastStatus = 502;
      const diagnostic = sanitizeSoundCloudErrorDetail(error?.message || error?.cause?.message || String(error || ''));
      lastDetail = diagnostic || 'search_request_failed';
    }
  }

  return {
    ok: false,
    status: lastStatus,
    detail: sanitizeSoundCloudErrorDetail(`${lastDetail || 'search_request_failed'}${lastEndpoint ? ` @ ${lastEndpoint}` : ''}`),
    collection: []
  };
}

async function fetchSoundCloudPublicClientId(query) {
  const searchUrl = new URL(SOUND_CLOUD_PUBLIC_SEARCH_PAGE_URL);
  searchUrl.searchParams.set('q', query);

  try {
    const response = await fetch(searchUrl.toString(), { headers: { Accept: 'text/html' } });
    if (!response.ok) return '';

    const html = await response.text();
    const match = html.match(/\"hydratable\":\"apiClient\",\"data\":\{\"id\":\"([A-Za-z0-9]+)\"/);
    return sanitizeText(match?.[1] || '', 120);
  } catch {
    return '';
  }
}

async function handleAdminSoundCloudResolve(request, env) {
  const clientId = sanitizeText(env.SOUNDCLOUD_CLIENT_ID || '', 180);
  const clientSecret = sanitizeText(env.SOUNDCLOUD_CLIENT_SECRET || '', 220);
  if (!clientId) {
    return json({ error: 'SoundCloud client id is not configured.', code: 'soundcloud_not_configured', status: 500, detail: 'missing_client_id', candidates: [] }, 500);
  }

  const url = new URL(request.url);
  const trackName = sanitizeText(url.searchParams.get('trackName') || '', 220);
  const artists = url.searchParams.getAll('artist').map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 6);
  const query = buildSoundCloudSearchQuery(trackName, artists);
  if (!query) return json({ error: 'Track name is required.', code: 'invalid_query', candidates: [] }, 400);

  let accessToken = '';
  if (clientSecret) {
    const tokenResult = await requestSoundCloudClientToken(clientId, clientSecret);
    if (!tokenResult.token) {
      return json({
        error: 'Unable to get SoundCloud OAuth access token.',
        code: 'soundcloud_token_failed',
        status: tokenResult.status || 500,
        detail: tokenResult.detail || 'token_failed',
        query,
        candidates: []
      }, tokenResult.status || 500);
    }
    accessToken = tokenResult.token;
  }

  const searchResult = await fetchSoundCloudTracks({ query, clientId, accessToken });
  let effectiveSearchResult = searchResult;
  if (!effectiveSearchResult.ok && (effectiveSearchResult.status === 401 || effectiveSearchResult.status === 403)) {
    const publicClientId = await fetchSoundCloudPublicClientId(query);
    if (publicClientId && publicClientId !== clientId) {
      effectiveSearchResult = await fetchSoundCloudTracks({ query, clientId: publicClientId, accessToken: '' });
    }
  }

  if (!effectiveSearchResult.ok) {
    return json({
      error: 'SoundCloud search request failed.',
      code: 'soundcloud_search_failed',
      status: effectiveSearchResult.status || 500,
      detail: effectiveSearchResult.detail || 'search_failed',
      query,
      candidates: []
    }, effectiveSearchResult.status || 500);
  }

  const collection = effectiveSearchResult.collection;
  const candidates = collection
    .map((track) => mapSoundCloudTrack(track, { trackName, artists }))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return right.durationMs - left.durationMs;
    })
    .slice(0, 5);

  if (!candidates.length) {
    return json({ error: 'No SoundCloud match found for this queue track.', code: 'soundcloud_not_found', status: 404, detail: '', query, candidates: [] }, 404);
  }

  const verifiedCandidates = candidates.filter((candidate) =>
    candidate.acceptable
    && candidate.artistStrictMatched
    && candidate.officialLikeArtistMatch
    && !candidate.variantLikely
    && candidate.matchScore >= 120
  );
  if (!verifiedCandidates.length) {
    return json({
      error: 'No artist-verified SoundCloud match found for this song.',
      code: 'soundcloud_not_found',
      status: 404,
      detail: 'no_artist_verified_match',
      query,
      candidates: candidates.map((entry) => ({
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        matchScore: entry.matchScore,
        titleMatched: entry.titleMatched,
        artistMatched: entry.artistMatched,
        artistStrictMatched: entry.artistStrictMatched,
        officialLikeArtistMatch: entry.officialLikeArtistMatch
      }))
    }, 404);
  }

  const match = verifiedCandidates[0];
  return json({
    query,
    match: {
      id: match.id,
      title: match.title,
      artist: match.artist,
      durationMs: match.durationMs,
      artworkUrl: match.artworkUrl,
      permalinkUrl: match.permalinkUrl,
      apiTrackUrl: match.apiTrackUrl
    },
    widgetSrc: buildSoundCloudWidgetSrc(match.apiTrackUrl || match.permalinkUrl),
    candidates: candidates.map((entry) => ({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      matchScore: entry.matchScore,
      titleMatched: entry.titleMatched,
      artistMatched: entry.artistMatched,
      artistStrictMatched: entry.artistStrictMatched,
      officialLikeArtistMatch: entry.officialLikeArtistMatch,
      durationMs: entry.durationMs,
      artworkUrl: entry.artworkUrl,
      permalinkUrl: entry.permalinkUrl,
      apiTrackUrl: entry.apiTrackUrl
    }))
  });
}

async function getSpotifyAccessToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return { error: json({ error: 'Spotify credentials are not configured' }, 500), token: '' };
  }

  const auth = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!tokenResponse.ok) {
    return { error: json({ error: 'Unable to retrieve Spotify token' }, tokenResponse.status), token: '' };
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return { error: json({ error: 'Spotify token missing in response' }, 500), token: '' };
  }

  return { error: null, token: tokenData.access_token };
}

async function handleSpotifySearch(request, env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return json({ error: 'Search query is required' }, 400);
  const type = normalizeSpotifySearchType(url.searchParams.get('type'));
  const spotifyType = type === 'all' ? 'track,album,artist' : type;
  const limit = clampNumber(Number(url.searchParams.get('limit')) || 24, 1, 50);
  const offset = clampNumber(Number(url.searchParams.get('offset')) || 0, 0, 950);

  const tokenResult = await getSpotifyAccessToken(env);
  if (tokenResult.error) return tokenResult.error;

  const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${spotifyType}&limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${tokenResult.token}` }
  });

  if (!searchResponse.ok) return json({ error: 'Spotify search request failed' }, searchResponse.status);

  const searchData = await searchResponse.json();
  const tracks = (searchData.tracks?.items || []).map((track) => ({
    kind: 'track',
    id: track.id,
    name: track.name,
    artists: (track.artists || []).map((artist) => artist.name),
    albumName: track.album?.name || '',
    albumImage: track.album?.images?.[0]?.url || '',
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    confidence: deriveContentConfidence(track.explicit),
    spotifyUrl: track.external_urls?.spotify || '',
    previewUrl: track.preview_url || '',
    durationMs: Math.max(0, Number(track.duration_ms) || 0)
  }));

  const albums = (searchData.albums?.items || []).map((album) => ({
    kind: 'album',
    id: album.id,
    name: album.name,
    artists: (album.artists || []).map((artist) => artist.name),
    albumName: album.name || '',
    albumImage: album.images?.[0]?.url || '',
    explicit: null,
    confidence: 'unknown',
    spotifyUrl: album.external_urls?.spotify || '',
    previewUrl: '',
    releaseDate: album.release_date || '',
    totalTracks: Number(album.total_tracks || 0)
  }));

  const artists = (searchData.artists?.items || []).map((artist) => ({
    kind: 'artist',
    id: artist.id,
    name: artist.name,
    artists: [artist.name],
    albumName: '',
    albumImage: artist.images?.[0]?.url || '',
    explicit: null,
    confidence: 'unknown',
    spotifyUrl: artist.external_urls?.spotify || '',
    previewUrl: '',
    followers: Number(artist.followers?.total || 0)
  }));

  const trackTotal = Number(searchData.tracks?.total || 0);
  const albumTotal = Number(searchData.albums?.total || 0);
  const artistTotal = Number(searchData.artists?.total || 0);
  const trackHasMore = type !== 'album' && type !== 'artist' && (offset + limit) < trackTotal;
  const albumHasMore = type !== 'track' && type !== 'artist' && (offset + limit) < albumTotal;
  const artistHasMore = type !== 'track' && type !== 'album' && (offset + limit) < artistTotal;

  let items = [];
  if (type === 'track') items = tracks;
  else if (type === 'album') items = albums;
  else if (type === 'artist') items = artists;
  else items = [...tracks, ...albums, ...artists];

  return json({
    items,
    tracks,
    albums,
    artists,
    page: {
      type,
      limit,
      offset,
      trackTotal,
      albumTotal,
      artistTotal,
      trackHasMore,
      albumHasMore,
      artistHasMore,
      hasMore: trackHasMore || albumHasMore || artistHasMore
    }
  });
}

async function handleSpotifyAlbumTracks(request, env, rawAlbumId) {
  const albumId = sanitizeText(rawAlbumId, 100);
  if (!albumId) return json({ error: 'Album id is required' }, 400);

  const tokenResult = await getSpotifyAccessToken(env);
  if (tokenResult.error) return tokenResult.error;

  const albumResponse = await fetch(`https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`, {
    headers: { Authorization: `Bearer ${tokenResult.token}` }
  });
  if (!albumResponse.ok) return json({ error: 'Unable to load album' }, albumResponse.status);

  const album = await albumResponse.json();
  const albumInfo = {
    id: album.id,
    name: album.name || '',
    artists: (album.artists || []).map((artist) => artist.name),
    image: album.images?.[0]?.url || '',
    spotifyUrl: album.external_urls?.spotify || '',
    releaseDate: album.release_date || '',
    totalTracks: Number(album.total_tracks || 0)
  };

  const tracks = [];
  let nextUrl = `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}/tracks?limit=50&offset=0`;
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${tokenResult.token}` }
    });
    if (!response.ok) return json({ error: 'Unable to load album tracks' }, response.status);

    const page = await response.json();
    (page.items || []).forEach((track) => {
      tracks.push({
        kind: 'track',
        id: track.id || `${albumId}:${track.track_number}`,
        name: track.name || '',
        artists: (track.artists || []).map((artist) => artist.name),
        albumName: albumInfo.name,
        albumImage: albumInfo.image,
        explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
        confidence: deriveContentConfidence(track.explicit),
        spotifyUrl: track.external_urls?.spotify || '',
        previewUrl: track.preview_url || '',
        durationMs: Math.max(0, Number(track.duration_ms) || 0),
        trackNumber: Number(track.track_number || 0)
      });
    });

    nextUrl = page.next || '';
  }

  return json({ album: albumInfo, items: tracks });
}
function requireAdmin(request, env) {
  if (!getAdminCredentials(env)) return adminCredentialsMissingResponse();
  if (!isAdminAuthorized(request, env)) return unauthorizedResponse();
  return null;
}

function getPacificDateParts(dateValue = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const map = {};
  formatter.formatToParts(dateValue).forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });

  return {
    year: Number(map.year || 0),
    month: Number(map.month || 0),
    day: Number(map.day || 0),
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
    second: Number(map.second || 0)
  };
}

function createNightlyDateKey(dateValue = new Date()) {
  const pacific = getPacificDateParts(dateValue);
  const year = String(pacific.year).padStart(4, '0');
  const month = String(pacific.month).padStart(2, '0');
  const day = String(pacific.day).padStart(2, '0');
  return `${year}${month}${day}`;
}

function shouldRunNightlyBenchmark(dateValue, env) {
  if (String(env?.ENABLE_NIGHTLY_BENCHMARK || '') !== '1') return false;
  if (String(env?.DISABLE_NIGHTLY_BENCHMARK || '') === '1') return false;
  const pacific = getPacificDateParts(dateValue);
  return pacific.hour === 3;
}

function seededShuffle(list, seedText) {
  const items = [...list];
  let seed = 0;
  String(seedText || '').split('').forEach((char) => {
    seed = ((seed * 31) + char.charCodeAt(0)) >>> 0;
  });
  if (!seed) seed = 123456789;

  const next = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    const temp = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = temp;
  }

  return items;
}

async function ensureNightlyBenchmarkTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS nightly_benchmark_runs (
      run_key TEXT PRIMARY KEY,
      run_at TEXT NOT NULL,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      approved_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      cleaned_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )`
  ).run();
}

async function runNightlyBenchmark(env, scheduledAt = new Date()) {
  const runAt = scheduledAt instanceof Date ? scheduledAt : new Date(String(scheduledAt || ''));
  if (!shouldRunNightlyBenchmark(runAt, env)) {
    return { skipped: true, reason: 'outside_3am_pacific_window' };
  }

  await ensureNightlyBenchmarkTable(env);
  const runKey = createNightlyDateKey(runAt);
  const existing = await env.DB.prepare('SELECT run_key FROM nightly_benchmark_runs WHERE run_key = ?').bind(runKey).first();
  if (existing?.run_key) {
    return { skipped: true, reason: 'already_ran_today', runKey };
  }

  const shuffledPool = seededShuffle(NIGHTLY_BENCHMARK_SONG_POOL, runKey);
  const goodSongs = shuffledPool.filter((song) => song.bucket === 'good').slice(0, 4);
  const edgeSongs = shuffledPool.filter((song) => song.bucket === 'edge').slice(0, 4);
  const badSongs = shuffledPool.filter((song) => song.bucket === 'bad').slice(0, 4);
  const playlist = seededShuffle([...goodSongs, ...edgeSongs, ...badSongs], `${runKey}-mix`);
  const nowIso = new Date().toISOString();

  let insertedCount = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  for (let index = 0; index < playlist.length; index += 1) {
    const song = playlist[index];
    const trackId = `nightly-eval-${runKey}-${index + 1}`;
    const artists = [song.artist];
    const contentConfidence = deriveContentConfidence(song.explicit);
    const autoDecision = await getAutoModerationDecision({
      trackName: song.name,
      artists,
      contentConfidence,
      env
    });

    const requesters = [buildRequesterEntry({
      requesterName: 'Nightly Benchmark Bot',
      requesterRole: 'admin',
      customMessage: 'nightly_benchmark_autogen',
      dedicationMessage: '',
      submittedAt: nowIso
    })];

    const priorityScore = calculatePriorityScore({
      voteCount: 1,
      requesterRoles: ['admin'],
      eventDate: null,
      contentConfidence,
      danceMoment: 'anytime',
      energyLevel: 3
    });

    const nextSetOrder = autoDecision.status === 'rejected' ? null : (await getMaxActiveSetOrder(env)) + 1;
    await env.DB.prepare(
      `INSERT INTO requests
        (track_id, track_name, artists, album_name, album_image, spotify_url,
         requester_name, requester_role, custom_message, dedication_message,
         event_date, explicit_flag, content_confidence, dance_moment, energy_level, vibe_tags,
         vote_count, requesters_json, priority_score, status, review_note, moderation_reason, dj_notes, set_order, submitted_at)
       VALUES (?, ?, ?, '', '', '', ?, ?, ?, '', NULL, ?, ?, 'anytime', 3, '[]', 1, ?, ?, ?, ?, ?, '', ?, ?)`
    ).bind(
      trackId,
      song.name,
      JSON.stringify(artists),
      'Nightly Benchmark Bot',
      'admin',
      'nightly_benchmark_autogen',
      song.explicit ? 1 : 0,
      contentConfidence,
      JSON.stringify(requesters),
      priorityScore,
      autoDecision.status,
      autoDecision.reviewNote,
      autoDecision.moderationReason,
      nextSetOrder,
      nowIso
    ).run();

    insertedCount += 1;
    if (autoDecision.status === 'approved') approvedCount += 1;
    else if (autoDecision.status === 'pending') pendingCount += 1;
    else rejectedCount += 1;
  }

  await renumberActiveQueue(env);
  const cleanupResult = await env.DB.prepare(
    "DELETE FROM requests WHERE track_id LIKE ? AND custom_message = 'nightly_benchmark_autogen'"
  ).bind(`nightly-eval-${runKey}-%`).run();
  await renumberActiveQueue(env);

  const cleanedCount = Number(cleanupResult.meta?.changes || 0);
  const notes = `seed=${runKey}; inserted=${insertedCount}; cleaned=${cleanedCount}; buckets=good:${goodSongs.length},edge:${edgeSongs.length},bad:${badSongs.length}`;
  await env.DB.prepare(
    `INSERT INTO nightly_benchmark_runs
      (run_key, run_at, inserted_count, approved_count, pending_count, rejected_count, cleaned_count, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(runKey, nowIso, insertedCount, approvedCount, pendingCount, rejectedCount, cleanedCount, notes).run();

  return {
    skipped: false,
    runKey,
    insertedCount,
    approvedCount,
    pendingCount,
    rejectedCount,
    cleanedCount
  };
}

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env.ALLOWED_ORIGIN || '*');

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), corsHeaders);
    }

    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return withCors(json({ ok: true, service: 'music-queue-api' }), corsHeaders);
      }

      const routePath = url.pathname.startsWith('/api/dj/')
        ? `/api/admin/${url.pathname.slice('/api/dj/'.length)}`
        : url.pathname;

      if (request.method === 'POST' && routePath === '/api/admin/login') {
        return withCors(await handleAdminLogin(request, env), corsHeaders);
      }

      if (request.method === 'GET' && routePath === '/api/admin/session') {
        return withCors(await handleAdminSession(request, env), corsHeaders);
      }

      if (request.method === 'GET' && routePath === '/api/admin/queue') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminGetQueue(request, env), corsHeaders);
      }

      if (request.method === 'PATCH' && routePath.startsWith('/api/admin/queue/')) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = routePath.split('/').pop();
        return withCors(await handleAdminUpdateQueue(request, env, id), corsHeaders);
      }

      if (request.method === 'DELETE' && routePath.startsWith('/api/admin/queue/')) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = routePath.split('/').pop();
        return withCors(await handleAdminDeleteQueueItem(env, id), corsHeaders);
      }

      if (request.method === 'POST' && routePath === '/api/admin/bulk') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminBulkAction(request, env), corsHeaders);
      }

      if (request.method === 'POST' && routePath === '/api/admin/reorder') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminReorder(request, env), corsHeaders);
      }

      if (request.method === 'POST' && routePath === '/api/admin/control') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminControl(request, env), corsHeaders);
      }

      if (request.method === 'GET' && routePath === '/api/admin/analytics') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetAdminAnalytics(env), corsHeaders);
      }

      if (request.method === 'GET' && routePath === '/api/admin/playback') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetDjPlayback(env, request), corsHeaders);
      }

      if (request.method === 'POST' && routePath === '/api/admin/playback/now-playing') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleSetDjNowPlaying(request, env), corsHeaders);
      }

      if (request.method === 'POST' && routePath === '/api/admin/playback/mark-played') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleMarkDjPlaybackHistory(request, env), corsHeaders);
      }

      if (request.method === 'GET' && routePath === '/api/admin/soundcloud/resolve') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(
          json(
            {
              error: 'SoundCloud playback is disabled. Use Spotify playback only.',
              code: 'soundcloud_disabled'
            },
            410
          ),
          corsHeaders
        );
      }

      if (request.method === 'GET' && url.pathname === '/api/public/queue') {
        return withCors(await handleGetPublicQueue(request, env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/public/feed') {
        return withCors(await handleGetPublicFeed(env), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/public/request') {
        return withCors(await handleCreateRequest(request, env), corsHeaders);
      }

      if (request.method === 'GET' && (url.pathname === '/api/public/spotify/search' || url.pathname === '/api/spotify/search')) {
        return withCors(await handleSpotifySearch(request, env), corsHeaders);
      }

      if (request.method === 'GET' && (url.pathname.startsWith('/api/public/spotify/album/') || url.pathname.startsWith('/api/spotify/album/')) && url.pathname.endsWith('/tracks')) {
        const parts = url.pathname.split('/');
        const albumId = parts[parts.length - 2] || '';
        return withCors(await handleSpotifyAlbumTracks(request, env, albumId), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/queue') {
        return withCors(await handleCreateRequest(request, env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/queue') {
        if (isAdminAuthorized(request, env)) {
          return withCors(await handleAdminGetQueue(request, env), corsHeaders);
        }
        return withCors(await handleGetPublicQueue(request, env), corsHeaders);
      }

      if (request.method === 'PATCH' && url.pathname.startsWith('/api/queue/')) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = url.pathname.split('/').pop();
        return withCors(await handleAdminUpdateQueue(request, env, id), corsHeaders);
      }

      if (request.method === 'DELETE' && url.pathname.startsWith('/api/queue/')) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = url.pathname.split('/').pop();
        return withCors(await handleAdminDeleteQueueItem(env, id), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/analytics') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetAdminAnalytics(env), corsHeaders);
      }

      return withCors(json({ error: 'Not found' }, 404), corsHeaders);
    } catch (error) {
      const message = String(error?.message || 'Unhandled error');
      const isMigrationError = /no such column|no such table/i.test(message);
      const response = isMigrationError
        ? json({ error: 'Database schema is outdated. Run D1 migrations and retry.' }, 500)
        : json({ error: message }, 500);
      return withCors(response, corsHeaders);
    }
  },

  async scheduled(controller, env, context) {
    const scheduledAt = controller?.scheduledTime ? new Date(controller.scheduledTime) : new Date();
    context.waitUntil(runNightlyBenchmark(env, scheduledAt));
  }
};
