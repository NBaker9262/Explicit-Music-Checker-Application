
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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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
const ALLOWED_ROLES = ['guest', 'student', 'staff', 'organizer', 'admin'];
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

const ROLE_WEIGHTS = { guest: 4, student: 8, staff: 14, organizer: 22, admin: 30 };
const MOMENT_WEIGHTS = { anytime: 3, grand_entrance: 14, warmup: 6, peak_hour: 18, slow_dance: 8, last_dance: 20 };
const MODERATION_TERMS = ['explicit', 'uncensored', 'dirty', 'parental advisory', 'violence', 'gun', 'drug', 'sex'];
const LYRICS_OVH_BASE_URL = 'https://api.lyrics.ovh/v1';
const LRCLIB_BASE_URL = 'https://lrclib.net/api/get';
const OPENAI_MODERATIONS_URL = 'https://api.openai.com/v1/moderations';
const LYRICS_MODERATION_HINT_TERMS = {
  suggestive: ['sex', 'sexy', 'kiss', 'touch', 'bed', 'naked', 'body', 'freak', 'hook up', 'make love', 'twerk'],
  alcohol: ['alcohol', 'drink', 'drunk', 'whiskey', 'vodka', 'tequila', 'beer', 'wine', 'shots', 'bar', 'bottle', 'liquor'],
  drugs: ['drug', 'drugs', 'weed', 'marijuana', 'cocaine', 'crack', 'meth', 'heroin', 'xanax', 'molly', 'ecstasy', 'lean', 'pills'],
  violence: ['gun', 'guns', 'shoot', 'murder', 'kill', 'blood', 'knife', 'fight', 'dead', 'die']
};
const LOCAL_PROFANITY_TERMS = ['fuck', 'fucking', 'shit', 'bitch', 'motherfucker', 'asshole', 'dick', 'pussy', 'nigga', 'nigger', 'cunt'];
const REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1000;
let rateLimitSchemaReady = false;

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

function checkProfanityLocally(lyricsText) {
  return LOCAL_PROFANITY_TERMS.some((term) => countKeywordHits(lyricsText, [term]) > 0);
}

async function analyzeLyricsModeration(trackName, artists, env) {
  const lyricsResult = await fetchLyricsForModeration(trackName, artists);
  const lyrics = lyricsResult.lyrics;

  if (!lyrics) {
    return {
      foundLyrics: false,
      provider: '',
      profanityDetected: false,
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

  const localProfanityDetected = checkProfanityLocally(lyrics);
  const openAiResult = await checkContentWithOpenAiModeration(lyrics, env);
  const openAiCategories = listOpenAiCategories(openAiResult.categories);
  const openAiSexual = hasOpenAiCategory(openAiResult.categories, 'sexual');
  const openAiViolence = hasOpenAiCategory(openAiResult.categories, 'violence');
  const openAiHate = hasOpenAiCategory(openAiResult.categories, 'hate');
  const openAiIllicit = hasOpenAiCategory(openAiResult.categories, 'illicit');
  const openAiHarassment = hasOpenAiCategory(openAiResult.categories, 'harassment');

  const profanityDetected = localProfanityDetected;
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

  const themeScore = Math.min(45, (suggestiveHits * 4) + (alcoholHits * 3) + (drugHits * 7) + (violenceHits * 6));
  const riskScore = clampNumber((profanityDetected ? 45 : 0) + themeScore + openAiScore, 0, 100);
  const riskLevel = riskScore >= 70 ? 'high' : riskScore >= 35 ? 'medium' : 'low';

  return {
    foundLyrics: true,
    provider: lyricsResult.provider,
    profanityDetected,
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
  if (lyricsAnalysis.profanityDetected) return 'explicit_lyrics';
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
  if (lyricsAnalysis.profanityDetected) parts.push('profanity detected');
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
  const lyricsAnalysis = env?.DISABLE_LYRICS_MODERATION === '1'
    ? {
      foundLyrics: false,
      provider: '',
      profanityDetected: false,
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

  if (confidence === 'explicit' || lyricsAnalysis.profanityDetected || lyricsAnalysis.riskLevel === 'high' || combinedScore < 35) {
    return {
      status: 'rejected',
      moderationReason: preferredReason,
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-marked explicit by moderation (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }

  if (lyricsAnalysis.riskLevel === 'medium') {
    return {
      status: 'pending',
      moderationReason: '',
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }

  if (confidence === 'clean' && combinedScore >= 70) {
    return {
      status: 'approved',
      moderationReason: '',
      reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-approved to queue (${combinedScore}).`),
      moderationScore: combinedScore
    };
  }

  return {
    status: 'pending',
    moderationReason: '',
    reviewNote: buildLyricsReviewNote(baseModerationScore, combinedScore, lyricsAnalysis, `Auto-flagged for review (${combinedScore}).`),
    moderationScore: combinedScore
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
  const danceMoment = normalizeDanceMoment(row.dance_moment);
  const energyLevel = normalizeEnergyLevel(row.energy_level);
  const requesterRoles = requesters.map((entry) => entry.role);

  const priorityScore = Number.isFinite(Number(row.priority_score))
    ? Number(row.priority_score)
    : calculatePriorityScore({ voteCount, requesterRoles, eventDate: row.event_date, contentConfidence, danceMoment, energyLevel });

  const parsedSetOrder = parseSetOrder(row.set_order);

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
    moderationReason: row.moderation_reason || '',
    voteCount,
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    status: row.status,
    reviewNote: row.review_note || '',
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
function getAdminCredentials(env) {
  const username = sanitizeText(env.ADMIN_USERNAME || '', 80);
  const password = sanitizeText(env.ADMIN_PASSWORD || '', 120);
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
    { error: 'Admin authorization required', hint: 'Use admin login first and send Authorization header.' },
    401,
    { 'WWW-Authenticate': 'Basic realm="Dance Admin"' }
  );
}

function adminCredentialsMissingResponse() {
  return json({ error: 'Admin credentials are not configured on this Worker.' }, 500);
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

async function runAdminControlAction(env, action) {
  const now = new Date().toISOString();
  const normalizedAction = sanitizeText(action, 64).toLowerCase();

  if (normalizedAction === 'play_next_approved') {
    const nextApproved = await env.DB.prepare(
      `SELECT id FROM requests
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

    await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(nextApproved.id).run();
    await renumberActiveQueue(env);
    return { updatedCount: 1, action: normalizedAction, playedItemId: Number(nextApproved.id) };
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

  return { updatedCount: 0, action: normalizedAction, error: 'Unsupported control action' };
}

function buildAnalyticsFromRows(rows) {
  const statusBreakdown = { pending: 0, approved: 0, rejected: 0 };
  const danceMomentBreakdown = new Map();
  const vibeTagBreakdown = new Map();
  const artistVotes = new Map();
  const trackVotes = new Map();
  const moderationReasonBreakdown = new Map();

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
  });

  const topRequestedArtists = [...artistVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([artist, votes]) => ({ artist, votes }));
  const topRequestedTracks = [...trackVotes.values()].sort((a, b) => b.votes - a.votes).slice(0, 10);
  const danceMoments = [...danceMomentBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([danceMoment, votes]) => ({ danceMoment, votes }));
  const vibeTags = [...vibeTagBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([tag, votes]) => ({ tag, votes }));
  const moderationReasons = [...moderationReasonBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

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

  const clientIp = getClientIp(request);
  const limitResult = await checkAndConsumeRateLimit(env, clientIp);
  if (!limitResult.allowed) {
    return json({
      error: 'You can request one song every 10 minutes from this device/network.',
      retryAfterSec: limitResult.retryAfterSec,
      nextAllowedAt: limitResult.nextAllowedAt
    }, 429, { 'Retry-After': String(limitResult.retryAfterSec) });
  }

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT * FROM requests WHERE track_id = ? AND status != 'rejected' ORDER BY id DESC LIMIT 1"
  ).bind(payload.trackId).first();

  if (existing) {
    const existingRequesters = parseRequesters(existing.requesters_json);
    existingRequesters.push(buildRequesterEntry({
      requesterName: payload.requesterName,
      requesterRole: payload.requesterRole,
      customMessage: payload.customMessage,
      dedicationMessage: payload.dedicationMessage,
      submittedAt: now
    }));

    const voteCount = Math.max(Number(existing.vote_count) || 1, existingRequesters.length);
    const mergedEventDate = chooseHigherPriorityEventDate(existing.event_date, payload.eventDate);
    const existingConfidence = deriveContentConfidence(existing.content_confidence);
    const mergedConfidence = existingConfidence === 'unknown' ? payload.contentConfidence : existingConfidence;
    const mergedDanceMoment = chooseHigherPriorityDanceMoment(existing.dance_moment, payload.danceMoment);
    const mergedEnergyLevel = Math.max(normalizeEnergyLevel(existing.energy_level), payload.energyLevel);
    const mergedVibeTags = mergeVibeTags(parseVibeTags(existing.vibe_tags), payload.vibeTags);
    const mergedArtists = parseArtists(existing.artists);
    const autoDecision = await getAutoModerationDecision({
      trackName: existing.track_name || payload.trackName,
      artists: mergedArtists.length ? mergedArtists : payload.artists,
      contentConfidence: mergedConfidence,
      env
    });

    const previousStatus = normalizeStatus(existing.status) || 'pending';
    let nextStatus = previousStatus;
    let nextModerationReason = sanitizeText(existing.moderation_reason || '', 64);
    let nextReviewNote = sanitizeText(existing.review_note || '', 500);
    if (previousStatus !== 'approved') {
      nextStatus = autoDecision.status;
      nextModerationReason = autoDecision.moderationReason;
      nextReviewNote = autoDecision.reviewNote;
    }

    const existingSetOrder = parseSetOrder(existing.set_order);
    let nextSetOrder = existingSetOrder.valid ? existingSetOrder.value : null;
    if (nextStatus === 'rejected') {
      nextSetOrder = null;
    } else if (nextSetOrder === null) {
      nextSetOrder = (await getMaxActiveSetOrder(env)) + 1;
    }

    const priorityScore = calculatePriorityScore({
      voteCount,
      requesterRoles: existingRequesters.map((entry) => entry.role),
      eventDate: mergedEventDate,
      contentConfidence: mergedConfidence,
      danceMoment: mergedDanceMoment,
      energyLevel: mergedEnergyLevel
    });

    const highestRole = getHighestPriorityRole(existingRequesters.map((entry) => entry.role));

    await env.DB.prepare(
      `UPDATE requests
       SET vote_count = ?, requesters_json = ?, requester_role = ?, event_date = ?, explicit_flag = ?, content_confidence = ?,
           dance_moment = ?, energy_level = ?, vibe_tags = ?, dedication_message = ?, priority_score = ?,
           status = ?, moderation_reason = ?, review_note = ?, set_order = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      voteCount,
      JSON.stringify(existingRequesters),
      highestRole,
      mergedEventDate,
      payload.explicitFlag === null ? existing.explicit_flag : payload.explicitFlag ? 1 : 0,
      mergedConfidence,
      mergedDanceMoment,
      mergedEnergyLevel,
      JSON.stringify(mergedVibeTags),
      existing.dedication_message || payload.dedicationMessage,
      priorityScore,
      nextStatus,
      nextModerationReason,
      nextReviewNote,
      nextSetOrder,
      now,
      existing.id
    ).run();

    await renumberActiveQueue(env);
    const merged = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(existing.id).first();
    return json({
      ...normalizeRequestRow(merged),
      duplicateJoined: true,
      retryAfterSec: limitResult.retryAfterSec,
      nextAllowedAt: limitResult.nextAllowedAt
    }, 200);
  }

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

  const autoDecision = await getAutoModerationDecision({
    trackName: payload.trackName,
    artists: payload.artists,
    contentConfidence: payload.contentConfidence,
    env
  });
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
    payload.explicitFlag === null ? null : payload.explicitFlag ? 1 : 0,
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
    nextAllowedAt: limitResult.nextAllowedAt
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
    return json({ error: 'Invalid admin credentials' }, 401);
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
    return json({ error: 'No admin updates were provided' }, 400);
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

  await renumberActiveQueue(env);

  const updated = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  return json(normalizeRequestRow(updated));
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

  const result = await runAdminControlAction(env, action);
  if (result.error) {
    return json({ error: result.error }, 400);
  }

  return json(result);
}

async function handleGetAdminAnalytics(env) {
  const result = await env.DB.prepare('SELECT * FROM requests').all();
  return json(buildAnalyticsFromRows(result.results || []));
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
    previewUrl: track.preview_url || ''
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

      if (request.method === 'POST' && url.pathname === '/api/admin/login') {
        return withCors(await handleAdminLogin(request, env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/session') {
        return withCors(await handleAdminSession(request, env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/queue') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminGetQueue(request, env), corsHeaders);
      }

      if (request.method === 'PATCH' && url.pathname.startsWith('/api/admin/queue/')) {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        const id = url.pathname.split('/').pop();
        return withCors(await handleAdminUpdateQueue(request, env, id), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/bulk') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminBulkAction(request, env), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/reorder') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminReorder(request, env), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/control') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleAdminControl(request, env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/analytics') {
        const unauthorized = requireAdmin(request, env);
        if (unauthorized) return withCors(unauthorized, corsHeaders);
        return withCors(await handleGetAdminAnalytics(env), corsHeaders);
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
  }
};
