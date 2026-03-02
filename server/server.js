
const express = require('express');
const path = require('path');
const fetchFn = global.fetch || require('node-fetch');

const spotifyRoutes = require('./spotify');

const app = express();

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
const DEFAULT_SAFE_TRACK_EXCEPTIONS = ['titanium'];
const REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const SOUND_CLOUD_TRACKS_BASE_URL = 'https://api.soundcloud.com/tracks';
const SOUND_CLOUD_SEARCH_V2_URL = 'https://api-v2.soundcloud.com/search/tracks';
const SOUND_CLOUD_OAUTH_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const SOUND_CLOUD_OAUTH_TOKEN_FALLBACK_URL = 'https://api.soundcloud.com/oauth2/token';
const SOUND_CLOUD_PUBLIC_SEARCH_PAGE_URL = 'https://soundcloud.com/search/sounds';

const queue = [];
let nextQueueId = 1;
const rateLimitByIp = new Map();
const djPlaybackState = {
  nowPlaying: null,
  history: []
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function parseIsoDateMs(value) {
  const raw = sanitizeText(value, 50);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSoundCloudMatchText(value) {
  const lowered = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return sanitizeText(lowered, 280).replace(/\s+/g, ' ').trim();
}

function tokenizeSoundCloudMatchText(value) {
  const normalized = normalizeSoundCloudMatchText(value);
  return normalized ? normalized.split(' ') : [];
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

  return score;
}

function mapSoundCloudTrack(track, { trackName, artists }) {
  const id = Number(track?.id || 0);
  const title = sanitizeText(track?.title || '', 220);
  const artist = sanitizeText(track?.user?.username || track?.publisher_metadata?.artist || '', 120);
  const permalinkUrl = sanitizeText(track?.permalink_url || '', 400);
  if (!id || !title || !permalinkUrl) return null;

  const durationMs = Math.max(0, Number(track?.duration || track?.full_duration || 0));
  const artworkUrl = sanitizeText(track?.artwork_url || track?.user?.avatar_url || '', 400);

  return {
    id,
    title,
    artist,
    durationMs,
    artworkUrl,
    permalinkUrl,
    apiTrackUrl: `https://api.soundcloud.com/tracks/${id}`,
    matchScore: computeSoundCloudMatchScore({
      trackName,
      artists,
      candidateTitle: title,
      candidateArtist: artist
    })
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

function getSoundCloudClientId() {
  return sanitizeText(process.env.SOUNDCLOUD_CLIENT_ID || '', 180);
}

function getSoundCloudClientSecret() {
  return sanitizeText(process.env.SOUNDCLOUD_CLIENT_SECRET || '', 220);
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
      const response = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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
      const response = await fetchFn(requestUrl, { headers });
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
    const response = await fetchFn(searchUrl.toString(), { headers: { Accept: 'text/html' } });
    if (!response.ok) return '';

    const html = await response.text();
    const match = html.match(/\"hydratable\":\"apiClient\",\"data\":\{\"id\":\"([A-Za-z0-9]+)\"/);
    return sanitizeText(match?.[1] || '', 120);
  } catch {
    return '';
  }
}

async function resolveSoundCloudTrack({ trackName, artists }) {
  const clientId = getSoundCloudClientId();
  const clientSecret = getSoundCloudClientSecret();
  if (!clientId) {
    return { status: 500, code: 'soundcloud_not_configured', error: 'SoundCloud client id is not configured.', detail: 'missing_client_id' };
  }

  const query = buildSoundCloudSearchQuery(trackName, artists);
  if (!query) return { status: 400, code: 'invalid_query', error: 'Track name is required.' };

  let accessToken = '';
  if (clientSecret) {
    const tokenResult = await requestSoundCloudClientToken(clientId, clientSecret);
    if (!tokenResult.token) {
      return {
        status: tokenResult.status || 500,
        code: 'soundcloud_token_failed',
        error: 'Unable to get SoundCloud OAuth access token.',
        detail: tokenResult.detail || 'token_failed',
        query,
        candidates: []
      };
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
    return {
      status: effectiveSearchResult.status || 500,
      code: 'soundcloud_search_failed',
      error: 'SoundCloud search request failed.',
      detail: effectiveSearchResult.detail || 'search_failed',
      query,
      candidates: []
    };
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
    return {
      status: 404,
      code: 'soundcloud_not_found',
      error: 'No SoundCloud match found for this queue track.',
      detail: '',
      query,
      candidates: []
    };
  }

  const [match] = candidates;
  return {
    status: 200,
    code: '',
    error: '',
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
    widgetSrc: buildSoundCloudWidgetSrc(match.permalinkUrl || match.apiTrackUrl),
    candidates: candidates.map((entry) => ({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      durationMs: entry.durationMs,
      artworkUrl: entry.artworkUrl,
      permalinkUrl: entry.permalinkUrl,
      apiTrackUrl: entry.apiTrackUrl
    }))
  };
}

function getClientIpLocal(req) {
  const cfIp = sanitizeText(req.get('CF-Connecting-IP') || '', 80);
  if (cfIp) return cfIp;

  const forwardedFor = sanitizeText(req.get('X-Forwarded-For') || '', 200);
  if (forwardedFor) {
    const first = sanitizeText((forwardedFor.split(',')[0] || ''), 80);
    if (first) return first;
  }

  const direct = sanitizeText(req.ip || req.socket?.remoteAddress || '', 80);
  return direct || 'unknown';
}

function checkAndConsumeRateLimitLocal(ipAddress) {
  const key = sanitizeText(ipAddress || 'unknown', 80) || 'unknown';
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastIso = rateLimitByIp.get(key) || '';
  const lastMs = parseIsoDateMs(lastIso);

  if (lastMs !== null) {
    const elapsed = nowMs - lastMs;
    if (elapsed < REQUEST_LIMIT_WINDOW_MS) {
      const waitMs = REQUEST_LIMIT_WINDOW_MS - elapsed;
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      const nextAllowedAt = new Date(lastMs + REQUEST_LIMIT_WINDOW_MS).toISOString();
      return { allowed: false, retryAfterSec, nextAllowedAt };
    }
  }

  rateLimitByIp.set(key, nowIso);
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

function normalizeTrackExceptionKey(value) {
  const normalized = sanitizeText(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '), 200);
  return normalized.replace(/\s+/g, ' ').trim();
}

function getSafeTrackExceptionSet() {
  const raw = sanitizeText(process.env.SAFE_TRACK_EXCEPTIONS || '', 2000);
  const entries = raw
    ? raw.split(',').map((entry) => normalizeTrackExceptionKey(entry)).filter(Boolean)
    : [];
  DEFAULT_SAFE_TRACK_EXCEPTIONS.forEach((entry) => {
    const key = normalizeTrackExceptionKey(entry);
    if (key && !entries.includes(key)) entries.push(key);
  });
  return new Set(entries);
}

function isSafeTrackException(trackName) {
  const key = normalizeTrackExceptionKey(trackName);
  if (!key) return false;
  return getSafeTrackExceptionSet().has(key);
}

function getAutoModerationDecision({ trackName, artists, contentConfidence }) {
  const confidence = deriveContentConfidence(contentConfidence);
  const moderationScore = calculateModerationScore({ trackName, artists, contentConfidence: confidence });

  if (isSafeTrackException(trackName) && confidence !== 'explicit') {
    return {
      status: 'approved',
      moderationReason: 'clean_version_verified',
      reviewNote: `Safe-song exception matched for "${sanitizeText(trackName, 120)}".`,
      moderationScore: Math.max(78, moderationScore)
    };
  }

  if (confidence === 'explicit' || moderationScore < 40) {
    return {
      status: 'rejected',
      moderationReason: confidence === 'explicit' ? 'explicit_lyrics' : 'policy_violation',
      reviewNote: `Auto-marked bad by moderation (${moderationScore}).`,
      moderationScore
    };
  }

  if (confidence === 'clean' && moderationScore >= 70) {
    return {
      status: 'approved',
      moderationReason: '',
      reviewNote: `Auto-approved to queue (${moderationScore}).`,
      moderationScore
    };
  }

  return {
    status: 'pending',
    moderationReason: '',
    reviewNote: `Auto-flagged for review (${moderationScore}).`,
    moderationScore
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
    playedAt: sanitizeText(payload?.playedAt || '', 40) || new Date().toISOString()
  };
}

function buildPlaybackTrackFromQueueItem(item, { playedBy = 'DJ', source = 'dj' } = {}) {
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

function setNowPlayingLocal(track) {
  djPlaybackState.nowPlaying = sanitizePlaybackTrackPayload(track);
  return djPlaybackState.nowPlaying;
}

function appendPlaybackHistoryLocal(track) {
  const entry = sanitizePlaybackTrackPayload(track);
  if (!entry.trackName || !entry.artists.length) return entry;
  djPlaybackState.history.unshift(entry);
  djPlaybackState.history = djPlaybackState.history.slice(0, 60);
  return entry;
}

function getPlaybackSnapshotLocal(limit = 20) {
  return {
    nowPlaying: djPlaybackState.nowPlaying,
    history: djPlaybackState.history.slice(0, clampNumber(Number(limit) || 20, 1, 60))
  };
}

function getMaxActiveSetOrderLocal() {
  return queue.reduce((maxOrder, entry) => {
    if (entry.status === 'rejected') return maxOrder;
    const parsed = parseSetOrder(entry.setOrder);
    if (!parsed.valid || parsed.value === null) return maxOrder;
    return Math.max(maxOrder, parsed.value);
  }, 0);
}

function renumberActiveQueueLocal() {
  const active = queue
    .filter((entry) => entry.status !== 'rejected')
    .sort((left, right) => {
      const leftOrder = parseSetOrder(left.setOrder).value;
      const rightOrder = parseSetOrder(right.setOrder).value;
      const safeLeft = leftOrder === null ? Number.MAX_SAFE_INTEGER : leftOrder;
      const safeRight = rightOrder === null ? Number.MAX_SAFE_INTEGER : rightOrder;
      if (safeLeft !== safeRight) return safeLeft - safeRight;
      return left.id - right.id;
    });

  active.forEach((entry, index) => {
    entry.setOrder = index + 1;
  });
}

function reorderActiveQueueLocal(itemId, beforeId) {
  const active = queue
    .filter((entry) => entry.status !== 'rejected')
    .sort((left, right) => {
      const leftOrder = parseSetOrder(left.setOrder).value;
      const rightOrder = parseSetOrder(right.setOrder).value;
      const safeLeft = leftOrder === null ? Number.MAX_SAFE_INTEGER : leftOrder;
      const safeRight = rightOrder === null ? Number.MAX_SAFE_INTEGER : rightOrder;
      if (safeLeft !== safeRight) return safeLeft - safeRight;
      return left.id - right.id;
    });

  const ids = active.map((entry) => entry.id);
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

  nextIds.forEach((id, index) => {
    const entry = queue.find((item) => item.id === id);
    if (entry) {
      entry.setOrder = index + 1;
      entry.updatedAt = new Date().toISOString();
    }
  });

  return { ok: true };
}

function runAdminControlActionLocal(action, options = {}) {
  const normalizedAction = sanitizeText(action, 64).toLowerCase();
  const now = new Date().toISOString();

  if (normalizedAction === 'play_next_approved') {
    const nextApproved = getSortedQueue(queue)
      .map(normalizeQueueItem)
      .find((item) => item.status === 'approved');

    if (!nextApproved) {
      return { updatedCount: 0, action: normalizedAction };
    }

    const index = queue.findIndex((entry) => entry.id === nextApproved.id);
    if (index >= 0) {
      const playbackTrack = buildPlaybackTrackFromQueueItem(nextApproved, {
        playedBy: sanitizeText(options.playedBy, 80) || 'DJ',
        source: 'play_next_approved'
      });
      setNowPlayingLocal(playbackTrack);
      appendPlaybackHistoryLocal(playbackTrack);
      queue.splice(index, 1);
    }
    renumberActiveQueueLocal();
    return { updatedCount: 1, action: normalizedAction, playedItemId: nextApproved.id, nowPlaying: djPlaybackState.nowPlaying };
  }

  if (normalizedAction === 'clear_all') {
    const count = queue.length;
    queue.splice(0, queue.length);
    return { updatedCount: count, action: normalizedAction };
  }

  if (normalizedAction === 'clear_approved') {
    const before = queue.length;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].status === 'approved') queue.splice(index, 1);
    }
    renumberActiveQueueLocal();
    return { updatedCount: before - queue.length, action: normalizedAction };
  }

  if (normalizedAction === 'clear_pending') {
    const before = queue.length;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].status === 'pending') queue.splice(index, 1);
    }
    renumberActiveQueueLocal();
    return { updatedCount: before - queue.length, action: normalizedAction };
  }

  if (normalizedAction === 'clear_denied') {
    const before = queue.length;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].status === 'rejected') queue.splice(index, 1);
    }
    return { updatedCount: before - queue.length, action: normalizedAction };
  }

  if (normalizedAction === 'renumber_active') {
    renumberActiveQueueLocal();
    return { updatedCount: 0, action: normalizedAction };
  }

  if (normalizedAction === 'pin_track') {
    const itemId = Number(options.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { updatedCount: 0, action: normalizedAction, error: 'Invalid item id' };
    }

    const item = queue.find((entry) => entry.id === itemId);
    if (!item) {
      return { updatedCount: 0, action: normalizedAction, error: 'Queue item not found' };
    }
    if (item.status === 'rejected') {
      return { updatedCount: 0, action: normalizedAction, error: 'Explicit items cannot be pinned to queue.' };
    }

    item.status = 'approved';
    item.moderationReason = '';
    item.reviewNote = 'Pinned to top by DJ.';
    item.setOrder = 0;
    item.updatedAt = now;
    renumberActiveQueueLocal();
    return { updatedCount: 1, action: normalizedAction, pinnedItemId: itemId };
  }

  return { updatedCount: 0, action: normalizedAction, error: 'Unsupported control action' };
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

function getAdminCredentials() {
  const username = sanitizeText(process.env.ADMIN_USERNAME || '', 80);
  const password = sanitizeText(process.env.ADMIN_PASSWORD || '', 120);
  if (!username || !password) return null;
  return { username, password };
}

function parseAuthorizationHeader(rawHeader) {
  const header = String(rawHeader || '').trim();
  if (!header) return { type: '', value: '' };
  const parts = header.split(/\s+/, 2);
  if (parts.length !== 2) return { type: '', value: '' };
  return { type: parts[0].toLowerCase(), value: parts[1] };
}

function decodeBase64(value) {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function isAdminAuthorized(req) {
  const credentials = getAdminCredentials();
  if (!credentials) return false;
  const parsed = parseAuthorizationHeader(req.get('Authorization'));
  const expectedToken = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

  if (parsed.type === 'basic') {
    return decodeBase64(parsed.value) === `${credentials.username}:${credentials.password}`;
  }

  if (parsed.type === 'bearer') {
    return parsed.value === expectedToken;
  }

  return false;
}

function requireAdmin(req, res) {
  if (!getAdminCredentials()) {
    res.status(500).json({ error: 'DJ credentials are not configured on this server.' });
    return false;
  }
  if (isAdminAuthorized(req)) return true;
  res.set('WWW-Authenticate', 'Basic realm="Dance Admin"');
  res.status(401).json({ error: 'DJ authorization required' });
  return false;
}

function normalizeQueueItem(item) {
  const voteCount = Math.max(1, Number(item.voteCount) || 1);
  const priorityScore = Number.isFinite(Number(item.priorityScore))
    ? Number(item.priorityScore)
    : calculatePriorityScore({
      voteCount,
      requesterRoles: (item.requesters || []).map((requester) => requester.role),
      eventDate: item.eventDate,
      contentConfidence: item.contentConfidence,
      danceMoment: item.danceMoment,
      energyLevel: item.energyLevel
    });

  const parsedSetOrder = parseSetOrder(item.setOrder);

  return {
    ...item,
    voteCount,
    requesterRole: normalizeRole(item.requesterRole || 'guest'),
    contentConfidence: deriveContentConfidence(item.contentConfidence),
    danceMoment: normalizeDanceMoment(item.danceMoment),
    energyLevel: normalizeEnergyLevel(item.energyLevel),
    vibeTags: normalizeVibeTags(item.vibeTags),
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    requesters: Array.isArray(item.requesters) ? item.requesters : [],
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null
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

function buildDuplicateConflictPayloadFromItem(item) {
  const parsedSetOrder = parseSetOrder(item?.setOrder);
  return {
    id: Number(item?.id || 0),
    trackId: sanitizeText(item?.trackId || '', 64),
    trackName: sanitizeText(item?.trackName || '', 200),
    status: normalizeStatus(item?.status) || 'pending',
    voteCount: Math.max(1, Number(item?.voteCount) || 1),
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null
  };
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

  const explicit = typeof body.explicit === 'boolean' ? body.explicit : null;
  const contentConfidence = deriveContentConfidence(explicit);
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
    explicit,
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

function getSortedQueue(items) {
  return [...items].sort((left, right) => {
    const leftStatusRank = left.status === 'rejected' ? 1 : 0;
    const rightStatusRank = right.status === 'rejected' ? 1 : 0;

    if (leftStatusRank !== rightStatusRank) return leftStatusRank - rightStatusRank;
    if (left.setOrder === null && right.setOrder !== null) return 1;
    if (left.setOrder !== null && right.setOrder === null) return -1;
    if (left.setOrder !== null && right.setOrder !== null && left.setOrder !== right.setOrder) {
      return left.setOrder - right.setOrder;
    }
    return left.id - right.id;
  });
}

function buildAnalyticsFromItems(items) {
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

  items.forEach((entry) => {
    const item = normalizeQueueItem(entry);
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

    requesterEntries.forEach((requester) => {
      recordRequesterMetric(requesterStats, {
        name: requester?.name || item.requesterName,
        status: item.status,
        submittedAt: requester?.submittedAt || item.submittedAt
      });
    });
  });

  const topRequesters = [...requesterStats.values()]
    .sort((left, right) => {
      if (right.requestCount !== left.requestCount) return right.requestCount - left.requestCount;
      const leftTs = parseIsoDateMs(left.lastRequestedAt) || 0;
      const rightTs = parseIsoDateMs(right.lastRequestedAt) || 0;
      if (rightTs !== leftTs) return rightTs - leftTs;
      return String(left.name || '').localeCompare(String(right.name || ''));
    })
    .slice(0, 20);

  return {
    totals: {
      requests: items.length,
      votes: totalVotes,
      approvedVotes,
      approvalRate: totalVotes > 0 ? Number(((approvedVotes / totalVotes) * 100).toFixed(1)) : 0,
      averagePriorityScore: totalVotes > 0 ? Number((weightedPrioritySum / totalVotes).toFixed(1)) : 0,
      averageEnergyLevel: totalVotes > 0 ? Number((weightedEnergySum / totalVotes).toFixed(1)) : 0,
      pendingHighPriority
    },
    statusBreakdown,
    topRequestedArtists: [...artistVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([artist, votes]) => ({ artist, votes })),
    topRequestedTracks: [...trackVotes.values()].sort((a, b) => b.votes - a.votes).slice(0, 10),
    topRequesters,
    danceMoments: [...danceMomentBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([danceMoment, votes]) => ({ danceMoment, votes })),
    vibeTags: [...vibeTagBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([tag, votes]) => ({ tag, votes })),
    moderationReasons: [...moderationReasonBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }))
  };
}
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/spotify', spotifyRoutes);
app.use('/api/public/spotify', spotifyRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'music-queue-api-local' });
});

app.post(['/api/admin/login', '/api/dj/login'], (req, res) => {
  const credentials = getAdminCredentials();
  if (!credentials) {
    return res.status(500).json({ error: 'Admin credentials are not configured on this server.' });
  }
  const username = sanitizeText(req.body?.username, 80);
  const password = sanitizeText(req.body?.password, 120);

  if (username !== credentials.username || password !== credentials.password) {
    return res.status(401).json({ error: 'Invalid DJ credentials' });
  }

  return res.json({
    ok: true,
    username: credentials.username,
    tokenType: 'Basic',
    token: Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
  });
});

app.get(['/api/admin/session', '/api/dj/session'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const credentials = getAdminCredentials();
  if (!credentials) {
    return res.status(500).json({ error: 'Admin credentials are not configured on this server.' });
  }
  res.json({ ok: true, username: credentials.username });
});

app.get('/api/public/queue', (req, res) => {
  const statusFilter = sanitizeText(req.query.status, 20).toLowerCase();
  if (statusFilter && statusFilter !== 'approved') {
    return res.status(400).json({ error: 'Public queue only supports approved tracks.' });
  }

  const limit = clampNumber(Number(req.query.limit) || 24, 1, 60);
  const items = getSortedQueue(queue)
    .map(normalizeQueueItem)
    .filter((item) => item.status === 'approved')
    .slice(0, limit)
    .map(projectPublicQueueItem);

  return res.json({ items });
});

app.get('/api/public/feed', (req, res) => {
  const normalized = getSortedQueue(queue).map(normalizeQueueItem);
  const upNext = normalized.filter((item) => item.status === 'approved').slice(0, 20).map(projectPublicQueueItem);
  const analytics = buildAnalyticsFromItems(normalized);

  return res.json({
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
});

app.post(['/api/public/request', '/api/queue'], (req, res) => {
  const payload = buildCreatePayload(req.body || {});
  if (!payload.trackId || !payload.trackName || !payload.artists.length || !payload.requesterName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existing = queue.find((item) => item.trackId === payload.trackId && item.status !== 'rejected');
  if (existing) {
    return res.status(409).json({
      error: 'This song is already in queue/review and cannot be requested again right now.',
      code: 'duplicate_active',
      existing: buildDuplicateConflictPayloadFromItem(existing)
    });
  }

  const isDjAuthorizedRequest = isAdminAuthorized(req);
  const isEvalBypassRequest = req.get('X-Eval-Bypass') === '1' && isDjAuthorizedRequest;
  const shouldBypassRateLimit = isDjAuthorizedRequest || isEvalBypassRequest;
  let limitResult = { allowed: true, retryAfterSec: Math.ceil(REQUEST_LIMIT_WINDOW_MS / 1000), nextAllowedAt: '' };
  if (!shouldBypassRateLimit) {
    const clientIp = getClientIpLocal(req);
    limitResult = checkAndConsumeRateLimitLocal(clientIp);
    if (!limitResult.allowed) {
      res.set('Retry-After', String(limitResult.retryAfterSec));
      return res.status(429).json({
        error: 'You can request one song every 10 minutes from this device/network.',
        retryAfterSec: limitResult.retryAfterSec,
        nextAllowedAt: limitResult.nextAllowedAt
      });
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

  const autoDecision = getAutoModerationDecision({
    trackName: payload.trackName,
    artists: payload.artists,
    contentConfidence: payload.contentConfidence
  });

  const item = {
    id: nextQueueId++,
    trackId: payload.trackId,
    trackName: payload.trackName,
    artists: payload.artists,
    albumName: payload.albumName,
    albumImage: payload.albumImage,
    spotifyUrl: payload.spotifyUrl,
    requesterName: payload.requesterName,
    requesterRole: payload.requesterRole,
    requesters,
    customMessage: payload.customMessage,
    dedicationMessage: payload.dedicationMessage,
    eventDate: payload.eventDate,
    explicit: payload.explicit,
    contentConfidence: payload.contentConfidence,
    danceMoment: payload.danceMoment,
    energyLevel: payload.energyLevel,
    vibeTags: payload.vibeTags,
    moderationReason: autoDecision.moderationReason,
    voteCount: 1,
    priorityScore: calculatePriorityScore({
      voteCount: 1,
      requesterRoles: [payload.requesterRole],
      eventDate: payload.eventDate,
      contentConfidence: payload.contentConfidence,
      danceMoment: payload.danceMoment,
      energyLevel: payload.energyLevel
    }),
    status: autoDecision.status,
    reviewNote: autoDecision.reviewNote,
    djNotes: '',
    setOrder: autoDecision.status === 'rejected' ? null : getMaxActiveSetOrderLocal() + 1,
    submittedAt: now,
    updatedAt: null
  };

  queue.unshift(item);
  return res.status(201).json({
    ...normalizeQueueItem(item),
    retryAfterSec: limitResult.retryAfterSec,
    nextAllowedAt: limitResult.nextAllowedAt || new Date(Date.now() + REQUEST_LIMIT_WINDOW_MS).toISOString()
  });
});
app.get(['/api/admin/queue', '/api/dj/queue', '/api/queue'], (req, res) => {
  if (!isAdminAuthorized(req)) {
    if (req.path === '/api/admin/queue' || req.path === '/api/dj/queue') {
      return requireAdmin(req, res);
    }

    const publicItems = getSortedQueue(queue)
      .map(normalizeQueueItem)
      .filter((item) => item.status === 'approved')
      .map(projectPublicQueueItem);
    return res.json({ items: publicItems });
  }

  const statusFilter = sanitizeText(req.query.status, 20).toLowerCase();
  const confidenceFilter = sanitizeText(req.query.confidence, 20).toLowerCase();
  const danceMomentFilter = sanitizeText(req.query.danceMoment, 32).toLowerCase();
  const search = sanitizeText(req.query.q, 80).toLowerCase();

  if (statusFilter && !ALLOWED_STATUSES.includes(statusFilter)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }
  if (confidenceFilter && !ALLOWED_CONFIDENCE.includes(confidenceFilter)) {
    return res.status(400).json({ error: 'Invalid confidence filter' });
  }
  if (danceMomentFilter && !ALLOWED_DANCE_MOMENTS.includes(danceMomentFilter)) {
    return res.status(400).json({ error: 'Invalid dance moment filter' });
  }

  let items = getSortedQueue(queue).map(normalizeQueueItem);

  if (statusFilter) items = items.filter((item) => item.status === statusFilter);
  if (confidenceFilter) items = items.filter((item) => item.contentConfidence === confidenceFilter);
  if (danceMomentFilter) items = items.filter((item) => item.danceMoment === danceMomentFilter);
  if (search) {
    items = items.filter((item) => {
      const haystack = `${item.trackName} ${item.artists.join(' ')} ${item.requesterName}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  return res.json({ items });
});

app.patch(['/api/admin/queue/:id', '/api/dj/queue/:id', '/api/queue/:id'], (req, res) => {
  if (!requireAdmin(req, res)) return;

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid queue item id' });
  }

  const item = queue.find((entry) => entry.id === itemId);
  if (!item) return res.status(404).json({ error: 'Queue item not found' });

  const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
  const hasReviewNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'reviewNote');
  const hasModerationReason = Object.prototype.hasOwnProperty.call(req.body || {}, 'moderationReason');
  const hasDanceMoment = Object.prototype.hasOwnProperty.call(req.body || {}, 'danceMoment');
  const hasEnergyLevel = Object.prototype.hasOwnProperty.call(req.body || {}, 'energyLevel');
  const hasDjNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'djNotes');
  const hasSetOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'setOrder');

  if (!hasStatus && !hasReviewNote && !hasModerationReason && !hasDanceMoment && !hasEnergyLevel && !hasDjNotes && !hasSetOrder) {
    return res.status(400).json({ error: 'No DJ updates were provided' });
  }

  const status = hasStatus ? normalizeStatus(req.body.status) : item.status;
  if (!status) return res.status(400).json({ error: 'Invalid status value' });

  const moderationReason = hasModerationReason ? normalizeModerationReason(req.body.moderationReason) : sanitizeText(item.moderationReason || '', 64);
  if (moderationReason === null) return res.status(400).json({ error: 'Invalid moderation reason preset' });

  let resolvedModerationReason = moderationReason || '';
  if (status === 'rejected' && !resolvedModerationReason) resolvedModerationReason = sanitizeText(item.moderationReason || '', 64);
  if (status === 'rejected' && !resolvedModerationReason) {
    return res.status(400).json({ error: 'Choose a moderation preset when rejecting a track' });
  }
  if (status !== 'rejected' && !hasModerationReason) resolvedModerationReason = '';

  const parsedSetOrder = hasSetOrder ? parseSetOrder(req.body.setOrder) : parseSetOrder(item.setOrder);
  if (!parsedSetOrder.valid) return res.status(400).json({ error: 'Invalid set order value' });

  let resolvedSetOrder = parsedSetOrder.value;
  if (status === 'rejected') {
    resolvedSetOrder = null;
  } else if (item.status === 'rejected') {
    resolvedSetOrder = resolvedSetOrder === null ? getMaxActiveSetOrderLocal() + 1 : resolvedSetOrder;
  } else if (resolvedSetOrder === null) {
    const existingSetOrder = parseSetOrder(item.setOrder);
    resolvedSetOrder = existingSetOrder.valid ? existingSetOrder.value : getMaxActiveSetOrderLocal() + 1;
  }

  item.status = status;
  item.reviewNote = hasReviewNote ? sanitizeText(req.body.reviewNote, 500) : item.reviewNote;
  item.moderationReason = resolvedModerationReason;
  item.danceMoment = hasDanceMoment ? normalizeDanceMoment(req.body.danceMoment) : item.danceMoment;
  item.energyLevel = hasEnergyLevel ? normalizeEnergyLevel(req.body.energyLevel) : item.energyLevel;
  item.djNotes = hasDjNotes ? sanitizeText(req.body.djNotes, 500) : item.djNotes;
  item.setOrder = resolvedSetOrder;
  item.priorityScore = calculatePriorityScore({
    voteCount: item.voteCount,
    requesterRoles: item.requesters.map((requester) => requester.role),
    eventDate: item.eventDate,
    contentConfidence: item.contentConfidence,
    danceMoment: item.danceMoment,
    energyLevel: item.energyLevel
  });
  item.updatedAt = new Date().toISOString();
  renumberActiveQueueLocal();

  return res.json(normalizeQueueItem(item));
});

app.post(['/api/admin/bulk', '/api/dj/bulk'], (req, res) => {
  if (!requireAdmin(req, res)) return;

  const action = sanitizeText(req.body?.action, 64).toLowerCase();
  const limit = clampNumber(Number(req.body?.limit) || 8, 1, 40);
  const now = new Date().toISOString();

  if (action === 'approve_clean_high_priority') {
    const targets = getSortedQueue(queue)
      .map(normalizeQueueItem)
      .filter((item) => item.status === 'pending' && item.contentConfidence === 'clean' && item.priorityScore >= 55)
      .slice(0, limit);

    targets.forEach((item) => {
      const original = queue.find((entry) => entry.id === item.id);
      original.status = 'approved';
      original.moderationReason = '';
      original.reviewNote = 'Bulk-approved clean/high-priority request.';
      original.updatedAt = now;
    });

    return res.json({ updatedCount: targets.length, updatedIds: targets.map((item) => item.id) });
  }

  if (action === 'reject_explicit') {
    const targets = getSortedQueue(queue)
      .map(normalizeQueueItem)
      .filter((item) => item.status === 'pending' && item.contentConfidence === 'explicit')
      .slice(0, limit);

    targets.forEach((item) => {
      const original = queue.find((entry) => entry.id === item.id);
      original.status = 'rejected';
      original.moderationReason = 'explicit_lyrics';
      original.reviewNote = 'Bulk-rejected explicit track.';
      original.updatedAt = now;
    });

    return res.json({ updatedCount: targets.length, updatedIds: targets.map((item) => item.id) });
  }

  return res.status(400).json({ error: 'Unsupported bulk action' });
});

app.post(['/api/admin/reorder', '/api/dj/reorder'], (req, res) => {
  if (!requireAdmin(req, res)) return;

  const itemId = Number(req.body?.itemId);
  const beforeId = req.body?.beforeId === null || req.body?.beforeId === undefined ? null : Number(req.body.beforeId);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId <= 0)) {
    return res.status(400).json({ error: 'Invalid before id' });
  }

  const result = reorderActiveQueueLocal(itemId, beforeId);
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'Unable to reorder queue' });
  }

  return res.json({ ok: true });
});

app.post(['/api/admin/control', '/api/dj/control'], (req, res) => {
  if (!requireAdmin(req, res)) return;

  const action = sanitizeText(req.body?.action, 64).toLowerCase();
  if (!action) {
    return res.status(400).json({ error: 'Control action is required' });
  }

  const result = runAdminControlActionLocal(action, {
    itemId: req.body?.itemId,
    playedBy: sanitizeText(req.body?.playedBy, 80) || 'DJ'
  });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json(result);
});

app.get(['/api/admin/analytics', '/api/dj/analytics', '/api/analytics'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const normalized = queue.map(normalizeQueueItem);
  return res.json(buildAnalyticsFromItems(normalized));
});

app.get(['/api/admin/playback', '/api/dj/playback'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const limit = clampNumber(Number(req.query?.limit) || 20, 1, 60);
  return res.json(getPlaybackSnapshotLocal(limit));
});

app.post(['/api/admin/playback/now-playing', '/api/dj/playback/now-playing'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const track = sanitizePlaybackTrackPayload({
    trackId: req.body?.trackId,
    trackName: req.body?.trackName,
    artists: req.body?.artists,
    albumImage: req.body?.albumImage,
    spotifyUrl: req.body?.spotifyUrl,
    playedBy: sanitizeText(req.body?.playedBy, 80) || 'DJ',
    source: sanitizeText(req.body?.source, 40) || 'dj_manual',
    playedAt: new Date().toISOString()
  });
  if (!track.trackName || !track.artists.length) {
    return res.status(400).json({ error: 'Track name and artists are required' });
  }
  return res.json({ ok: true, nowPlaying: setNowPlayingLocal(track) });
});

app.post(['/api/admin/playback/mark-played', '/api/dj/playback/mark-played'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const track = sanitizePlaybackTrackPayload({
    trackId: req.body?.trackId,
    trackName: req.body?.trackName,
    artists: req.body?.artists,
    albumImage: req.body?.albumImage,
    spotifyUrl: req.body?.spotifyUrl,
    playedBy: sanitizeText(req.body?.playedBy, 80) || 'DJ',
    source: sanitizeText(req.body?.source, 40) || 'dj_manual',
    playedAt: new Date().toISOString()
  });
  if (!track.trackName || !track.artists.length) {
    return res.status(400).json({ error: 'Track name and artists are required' });
  }
  setNowPlayingLocal(track);
  appendPlaybackHistoryLocal(track);
  return res.json({ ok: true });
});

app.get(['/api/admin/soundcloud/resolve', '/api/dj/soundcloud/resolve'], async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const trackName = sanitizeText(req.query.trackName, 220);
  const artistParams = Array.isArray(req.query.artist)
    ? req.query.artist
    : (typeof req.query.artist === 'string' ? [req.query.artist] : []);
  const artists = artistParams.map((artist) => sanitizeText(artist, 120)).filter(Boolean).slice(0, 6);

  const result = await resolveSoundCloudTrack({ trackName, artists });
  if (result.error) {
    return res.status(result.status || 500).json({
      error: result.error,
      code: result.code || 'soundcloud_error',
      status: result.status || 500,
      detail: result.detail || '',
      query: result.query || '',
      candidates: Array.isArray(result.candidates) ? result.candidates : []
    });
  }

  return res.json({
    query: result.query,
    match: result.match,
    widgetSrc: result.widgetSrc,
    candidates: result.candidates
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
