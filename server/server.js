
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fetchFn = global.fetch || require('node-fetch');

const spotifyRoutes = require('./spotify');

const app = express();

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
const DEFAULT_SAFE_TRACK_EXCEPTIONS = ['titanium', 'shut up and dance'];
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
const REQUEST_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const SPOTIFY_ACCOUNTS_BASE_URL = 'https://accounts.spotify.com';
const SPOTIFY_WEB_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_DJ_SCOPE = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
const SPOTIFY_DJ_OAUTH_TTL_MS = 10 * 60 * 1000;

const queue = [];
let nextQueueId = 1;
const rateLimitByIp = new Map();
const moderationLearning = new Map();
const djPlaybackState = {
  nowPlaying: null,
  history: []
};
const spotifyDjAuthState = {
  oauth: null,
  auth: null
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

function getStrictBlockedTrackSet() {
  const raw = sanitizeText(process.env.STRICT_BLOCK_TRACKS || '', 3000);
  const entries = raw
    ? raw.split(',').map((entry) => normalizeTrackExceptionKey(entry)).filter(Boolean)
    : [];
  DEFAULT_STRICT_BLOCKED_TRACKS.forEach((entry) => {
    const key = normalizeTrackExceptionKey(entry);
    if (key && !entries.includes(key)) entries.push(key);
  });
  return new Set(entries);
}

function isStrictBlockedTrack(trackName) {
  const key = normalizeTrackExceptionKey(trackName);
  if (!key) return false;
  return getStrictBlockedTrackSet().has(key);
}

function isSchoolSafeStrictModeLocal() {
  return String(process.env.SCHOOL_SAFE_MODE || '1') !== '0';
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

function recordModerationFeedbackLocal({ trackName, artists, status }) {
  const normalizedStatus = normalizeStatus(status);
  const trackKey = buildModerationLearningKey(trackName, artists);
  if (!trackKey || !normalizedStatus) return;

  const existing = moderationLearning.get(trackKey) || {
    trackName: sanitizeText(trackName, 200),
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    lastStatus: 'pending',
    updatedAt: ''
  };

  existing.trackName = sanitizeText(trackName, 200) || existing.trackName;
  existing.updatedAt = new Date().toISOString();
  existing.lastStatus = normalizedStatus;
  if (normalizedStatus === 'approved') existing.approvedCount += 1;
  if (normalizedStatus === 'pending') existing.pendingCount += 1;
  if (normalizedStatus === 'rejected') existing.rejectedCount += 1;

  moderationLearning.set(trackKey, existing);
}

function getModerationLearningHintLocal({ trackName, artists }) {
  const trackKey = buildModerationLearningKey(trackName, artists);
  if (!trackKey) return null;
  const row = moderationLearning.get(trackKey);
  if (!row) return null;

  const approvedCount = Math.max(0, Number(row.approvedCount) || 0);
  const pendingCount = Math.max(0, Number(row.pendingCount) || 0);
  const rejectedCount = Math.max(0, Number(row.rejectedCount) || 0);
  const totalFeedback = approvedCount + pendingCount + rejectedCount;
  if (totalFeedback < 2) return null;

  const statuses = [
    { status: 'approved', count: approvedCount },
    { status: 'pending', count: pendingCount },
    { status: 'rejected', count: rejectedCount }
  ].sort((left, right) => right.count - left.count);
  const preferred = statuses[0];
  return {
    approvedCount,
    pendingCount,
    rejectedCount,
    totalFeedback,
    preferredStatus: preferred.status,
    confidence: preferred.count / totalFeedback
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

function getAutoModerationDecision({ trackName, artists, contentConfidence }) {
  const confidence = deriveContentConfidence(contentConfidence);
  const moderationScore = calculateModerationScore({ trackName, artists, contentConfidence: confidence });
  const strictSchoolMode = isSchoolSafeStrictModeLocal();
  const blockedByTrackList = strictSchoolMode && isStrictBlockedTrack(trackName);

  if (blockedByTrackList) {
    return {
      status: 'rejected',
      moderationReason: 'policy_violation',
      reviewNote: `Blocked by school safety blocklist for "${sanitizeText(trackName, 120)}".`,
      moderationScore: 0,
      hardBlocked: true
    };
  }

  if (isSafeTrackException(trackName) && confidence !== 'explicit') {
    return {
      status: 'approved',
      moderationReason: 'clean_version_verified',
      reviewNote: `Safe-song exception matched for "${sanitizeText(trackName, 120)}".`,
      moderationScore: Math.max(78, moderationScore),
      hardBlocked: false
    };
  }

<<<<<<< HEAD
  if (confidence === 'explicit' || moderationScore < (strictSchoolMode ? 40 : 34)) {
=======
  if (confidence === 'explicit' || moderationScore < (strictSchoolMode ? 40 : 36)) {
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
    return {
      status: 'rejected',
      moderationReason: confidence === 'explicit' ? 'explicit_lyrics' : 'policy_violation',
      reviewNote: `Auto-marked bad by moderation (${moderationScore}).`,
      moderationScore,
      hardBlocked: false
    };
  }

<<<<<<< HEAD
  if (confidence === 'clean' && moderationScore >= (strictSchoolMode ? 84 : 72)) {
=======
  if (confidence === 'clean' && moderationScore >= (strictSchoolMode ? 76 : 66)) {
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
    return {
      status: 'approved',
      moderationReason: '',
      reviewNote: `Auto-approved to queue (${moderationScore}).`,
      moderationScore,
      hardBlocked: false
    };
  }

  return {
    status: 'pending',
    moderationReason: '',
    reviewNote: `Auto-flagged for review (${moderationScore}).`,
    moderationScore,
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
    recordModerationFeedbackLocal({
      trackName: item.trackName,
      artists: item.artists,
      status: 'approved'
    });
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
  const username = sanitizeText(process.env.DJ_USERNAME || process.env.ADMIN_USERNAME || '', 80);
  const password = sanitizeText(process.env.DJ_PASSWORD || process.env.ADMIN_PASSWORD || '', 120);
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

function base64UrlFromBuffer(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkceCodeVerifierLocal(byteLength = 64) {
  return base64UrlFromBuffer(crypto.randomBytes(byteLength));
}

function createPkceCodeChallengeLocal(codeVerifier) {
  const digest = crypto.createHash('sha256').update(String(codeVerifier || ''), 'utf8').digest();
  return base64UrlFromBuffer(digest);
}

function createSpotifyStateTokenLocal(byteLength = 16) {
  return base64UrlFromBuffer(crypto.randomBytes(byteLength));
}

async function parseJsonResponseSafeLocal(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeSpotifyDjTrackUriLocal(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (/^spotify:track:[A-Za-z0-9]{22}$/.test(value)) return value;
  if (/^[A-Za-z0-9]{22}$/.test(value)) return `spotify:track:${value}`;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const trackIndex = parts.indexOf('track');
    if (trackIndex >= 0 && parts[trackIndex + 1]) {
      const token = String(parts[trackIndex + 1] || '').trim();
      if (/^[A-Za-z0-9]{22}$/.test(token)) return `spotify:track:${token}`;
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeSpotifyDjDeviceIdLocal(rawValue) {
  const value = String(rawValue || '').trim();
  return /^[A-Za-z0-9]{8,200}$/.test(value) ? value : '';
}

function getSpotifyAuthHeaderLocal() {
  const clientId = sanitizeText(process.env.SPOTIFY_CLIENT_ID || '', 200);
  const clientSecret = sanitizeText(process.env.SPOTIFY_CLIENT_SECRET || '', 220);
  if (!clientId || !clientSecret) return '';
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function hasSpotifyClientCredentialsLocal() {
  return Boolean(getSpotifyAuthHeaderLocal());
}

function buildSpotifyDjCallbackUrlLocal(req) {
  const configured = sanitizeText(process.env.SPOTIFY_REDIRECT_URI || '', 500);
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return `${parsed.origin}${parsed.pathname}`;
      }
    } catch {
      // Ignore malformed override and fall back to request origin.
    }
  }

  return `${req.protocol}://${req.get('host')}/api/spotify/auth/callback`;
}

function resolveSpotifyDjReturnToLocal(req, rawReturnTo) {
  const apiOrigin = `${req.protocol}://${req.get('host')}`;
  const originHeader = sanitizeText(req.get('Origin') || '', 300);
  let requestOrigin = '';
  if (originHeader) {
    try {
      requestOrigin = new URL(originHeader).origin;
    } catch {
      requestOrigin = '';
    }
  }

  const allowedOrigins = new Set([apiOrigin]);
  if (requestOrigin) allowedOrigins.add(requestOrigin);

  const fallbackOrigin = requestOrigin || apiOrigin;
  const fallbackUrl = `${fallbackOrigin}/dj/dashboard.html`;
  const candidate = sanitizeText(rawReturnTo || '', 800);
  if (!candidate) return fallbackUrl;

  try {
    const parsed = new URL(candidate);
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) return fallbackUrl;
    if (!allowedOrigins.has(parsed.origin)) return fallbackUrl;
    return parsed.href;
  } catch {
    return fallbackUrl;
  }
}

function appendQueryParamsLocal(baseUrl, entries) {
  const parsed = new URL(baseUrl);
  Object.entries(entries || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const serialized = String(value || '').trim();
    if (!serialized) return;
    parsed.searchParams.set(key, serialized);
  });
  return parsed.toString();
}

async function getSpotifyDjUserAccessTokenLocal({ forceRefresh = false } = {}) {
  if (!hasSpotifyClientCredentialsLocal()) {
    return { error: { status: 500, message: 'Spotify credentials are not configured on this server.' }, token: '', auth: null };
  }

  const authState = spotifyDjAuthState.auth || null;
  const refreshToken = sanitizeText(authState?.refreshToken || '', 600);
  const existingAccessToken = sanitizeText(authState?.accessToken || '', 600);
  const expiresAtMs = parseIsoDateMs(authState?.expiresAt || '');
  const nowMs = Date.now();
  if (!refreshToken) {
    return { error: { status: 409, message: 'Spotify DJ account is not connected.' }, token: '', auth: null };
  }

  if (!forceRefresh && existingAccessToken && expiresAtMs !== null && (expiresAtMs - nowMs) > 60_000) {
    return { error: null, token: existingAccessToken, auth: authState };
  }

  const tokenResponse = await fetchFn(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
    method: 'POST',
    headers: {
      Authorization: getSpotifyAuthHeaderLocal(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  const tokenPayload = await parseJsonResponseSafeLocal(tokenResponse);
  if (!tokenResponse.ok) {
    const code = sanitizeText(tokenPayload?.error || '', 80).toLowerCase();
    if (code === 'invalid_grant' || tokenResponse.status === 400 || tokenResponse.status === 401) {
      spotifyDjAuthState.auth = null;
      return { error: { status: 409, message: 'Spotify connection expired. Reconnect Spotify to continue playback.' }, token: '', auth: null };
    }
    return { error: { status: 502, message: 'Unable to refresh Spotify DJ token.' }, token: '', auth: null };
  }

  const refreshedAccessToken = sanitizeText(tokenPayload?.access_token || '', 600);
  if (!refreshedAccessToken) {
    return { error: { status: 502, message: 'Spotify token response was missing an access token.' }, token: '', auth: null };
  }

  spotifyDjAuthState.auth = {
    refreshToken: sanitizeText(tokenPayload?.refresh_token || refreshToken, 600),
    accessToken: refreshedAccessToken,
    tokenType: sanitizeText(tokenPayload?.token_type || authState?.tokenType || 'Bearer', 40),
    scope: sanitizeText(tokenPayload?.scope || authState?.scope || SPOTIFY_DJ_SCOPE, 500),
    expiresAt: new Date(Date.now() + (Math.max(1, Number(tokenPayload?.expires_in) || 3600) * 1000)).toISOString(),
    connectedAt: sanitizeText(authState?.connectedAt || '', 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return { error: null, token: refreshedAccessToken, auth: spotifyDjAuthState.auth };
}

async function requestSpotifyDjApiLocal(path, { method = 'GET', body = null } = {}) {
  const tokenResult = await getSpotifyDjUserAccessTokenLocal();
  if (tokenResult.error) {
    return { error: tokenResult.error, response: null, payload: {} };
  }

  const requestOnce = async (token) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== null) headers['Content-Type'] = 'application/json';
    const response = await fetchFn(`${SPOTIFY_WEB_API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    });
    const payload = await parseJsonResponseSafeLocal(response);
    return { response, payload };
  };

  let current = await requestOnce(tokenResult.token);
  if (current.response.status === 401) {
    const refreshResult = await getSpotifyDjUserAccessTokenLocal({ forceRefresh: true });
    if (refreshResult.error) {
      return { error: refreshResult.error, response: null, payload: {} };
    }
    current = await requestOnce(refreshResult.token);
  }

  return { error: null, response: current.response, payload: current.payload };
}

function sendSpotifyDjErrorLocal(res, status, payload) {
  const message = sanitizeText(payload?.error?.message || payload?.error || '', 220);
  if (status === 403) return res.status(403).json({ error: message || 'Spotify denied playback control. Check Premium account and scopes.' });
  if (status === 404) return res.status(404).json({ error: message || 'No active Spotify playback target found. Start the browser player and retry.' });
  if (status === 401) return res.status(401).json({ error: message || 'Spotify authorization failed. Reconnect Spotify.' });
  return res.status(status || 502).json({ error: message || `Spotify request failed (${status || 502}).` });
}

function normalizeQueueItem(item) {
  const voteCount = Math.max(1, Number(item.voteCount) || 1);
  const contentConfidence = deriveContentConfidence(item.contentConfidence);
  const normalizedStatus = normalizeStatus(item.status) || 'pending';
  const reviewNote = sanitizeText(item.reviewNote || '', 500);
  const moderationReason = sanitizeText(item.moderationReason || '', 64);
  const priorityScore = Number.isFinite(Number(item.priorityScore))
    ? Number(item.priorityScore)
    : calculatePriorityScore({
      voteCount,
      requesterRoles: (item.requesters || []).map((requester) => requester.role),
      eventDate: item.eventDate,
      contentConfidence,
      danceMoment: item.danceMoment,
      energyLevel: item.energyLevel
    });

  const parsedSetOrder = parseSetOrder(item.setOrder);
  const filterExplanation = buildFilterExplanation({
    status: normalizedStatus,
    moderationReason,
    reviewNote,
    contentConfidence
  });

  return {
    ...item,
    voteCount,
    requesterRole: normalizeRole(item.requesterRole || 'guest'),
    contentConfidence,
    danceMoment: normalizeDanceMoment(item.danceMoment),
    energyLevel: normalizeEnergyLevel(item.energyLevel),
    vibeTags: normalizeVibeTags(item.vibeTags),
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    requesters: Array.isArray(item.requesters) ? item.requesters : [],
    setOrder: parsedSetOrder.valid ? parsedSetOrder.value : null,
    status: normalizedStatus,
    reviewNote,
    moderationReason,
    filterSummary: buildFilterSummary({
      status: normalizedStatus,
      moderationReason,
      reviewNote,
      contentConfidence
    }),
    filterReasonLabel: filterExplanation.reasonLabel,
    filterReasonDetail: filterExplanation.detail,
    moderationReasonCode: filterExplanation.moderationReasonCode
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
    return res.status(500).json({ error: 'DJ credentials are not configured on this server.' });
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
    return res.status(500).json({ error: 'DJ credentials are not configured on this server.' });
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

  let autoDecision = getAutoModerationDecision({
    trackName: payload.trackName,
    artists: payload.artists,
    contentConfidence: payload.contentConfidence
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
    autoDecision = applyModerationLearningHint(
      autoDecision,
      getModerationLearningHintLocal({ trackName: payload.trackName, artists: payload.artists })
    );
  }

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
  const previousStatus = item.status;

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
  if (hasStatus && previousStatus !== status) {
    recordModerationFeedbackLocal({
      trackName: item.trackName,
      artists: item.artists,
      status
    });
  }
  renumberActiveQueueLocal();

  return res.json(normalizeQueueItem(item));
});

app.delete(['/api/admin/queue/:id', '/api/dj/queue/:id', '/api/queue/:id'], (req, res) => {
  if (!requireAdmin(req, res)) return;

  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid queue item id' });
  }

  const index = queue.findIndex((entry) => entry.id === itemId);
  if (index < 0) return res.status(404).json({ error: 'Queue item not found' });

  const [deleted] = queue.splice(index, 1);
  renumberActiveQueueLocal();

  return res.json({
    ok: true,
    deletedId: itemId,
    trackName: sanitizeText(deleted.trackName || '', 200),
    status: normalizeStatus(deleted.status) || 'pending'
  });
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

app.get(['/api/admin/spotify/auth/start', '/api/dj/spotify/auth/start'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!hasSpotifyClientCredentialsLocal()) {
    return res.status(500).json({ error: 'Spotify credentials are not configured on this server.' });
  }

  const returnTo = resolveSpotifyDjReturnToLocal(req, req.query?.returnTo || '');
  const oauthState = createSpotifyStateTokenLocal();
  const codeVerifier = createPkceCodeVerifierLocal();
  const codeChallenge = createPkceCodeChallengeLocal(codeVerifier);
  const callbackUrl = buildSpotifyDjCallbackUrlLocal(req);
  spotifyDjAuthState.oauth = {
    state: oauthState,
    codeVerifier,
    returnTo,
    callbackUrl,
    createdAt: new Date().toISOString()
  };

  const params = new URLSearchParams({
    client_id: sanitizeText(process.env.SPOTIFY_CLIENT_ID || '', 200),
    response_type: 'code',
    redirect_uri: callbackUrl,
    scope: SPOTIFY_DJ_SCOPE,
    state: oauthState,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    show_dialog: 'false'
  });

  return res.json({
    authorizeUrl: `${SPOTIFY_ACCOUNTS_BASE_URL}/authorize?${params.toString()}`,
    expiresAt: new Date(Date.now() + SPOTIFY_DJ_OAUTH_TTL_MS).toISOString()
  });
});

app.get('/api/spotify/auth/callback', async (req, res) => {
  const code = sanitizeText(req.query?.code || '', 400);
  const state = sanitizeText(req.query?.state || '', 120);
  const spotifyError = sanitizeText(req.query?.error || '', 120);
  const pending = spotifyDjAuthState.oauth || null;
  const returnTo = sanitizeText(pending?.returnTo || '', 1000) || `${req.protocol}://${req.get('host')}/dj/dashboard.html`;
  const failRedirect = (reason) => res.redirect(appendQueryParamsLocal(returnTo, {
    spotifyAuth: 'error',
    reason: sanitizeText(reason || 'auth_failed', 80)
  }));

  if (spotifyError) {
    spotifyDjAuthState.oauth = null;
    return failRedirect(spotifyError);
  }

  if (!pending || !code || !state || sanitizeText(pending.state || '', 120) !== state) {
    spotifyDjAuthState.oauth = null;
    return failRedirect('invalid_state');
  }

  const createdAtMs = parseIsoDateMs(pending.createdAt || '');
  if (createdAtMs === null || (Date.now() - createdAtMs) > SPOTIFY_DJ_OAUTH_TTL_MS) {
    spotifyDjAuthState.oauth = null;
    return failRedirect('state_expired');
  }

  try {
    const tokenResponse = await fetchFn(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
      method: 'POST',
      headers: {
        Authorization: getSpotifyAuthHeaderLocal(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: sanitizeText(pending.callbackUrl || '', 400),
        client_id: sanitizeText(process.env.SPOTIFY_CLIENT_ID || '', 200),
        code_verifier: sanitizeText(pending.codeVerifier || '', 200)
      }).toString()
    });

    const tokenPayload = await parseJsonResponseSafeLocal(tokenResponse);
    if (!tokenResponse.ok) {
      spotifyDjAuthState.oauth = null;
      return failRedirect(sanitizeText(tokenPayload?.error || 'token_exchange_failed', 80));
    }

    const accessToken = sanitizeText(tokenPayload?.access_token || '', 600);
    const refreshToken = sanitizeText(tokenPayload?.refresh_token || '', 600);
    if (!accessToken || !refreshToken) {
      spotifyDjAuthState.oauth = null;
      return failRedirect('missing_token_data');
    }

    spotifyDjAuthState.auth = {
      refreshToken,
      accessToken,
      tokenType: sanitizeText(tokenPayload?.token_type || 'Bearer', 40),
      scope: sanitizeText(tokenPayload?.scope || SPOTIFY_DJ_SCOPE, 500),
      expiresAt: new Date(Date.now() + (Math.max(1, Number(tokenPayload?.expires_in) || 3600) * 1000)).toISOString(),
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    spotifyDjAuthState.oauth = null;
    return res.redirect(appendQueryParamsLocal(returnTo, { spotifyAuth: 'connected' }));
  } catch {
    spotifyDjAuthState.oauth = null;
    return failRedirect('token_exchange_failed');
  }
});

app.get(['/api/admin/spotify/auth/status', '/api/dj/spotify/auth/status'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const auth = spotifyDjAuthState.auth || null;
  const connected = Boolean(sanitizeText(auth?.refreshToken || '', 600));
  return res.json({
    connected,
    expiresAt: connected ? sanitizeText(auth?.expiresAt || '', 80) : '',
    scope: connected ? sanitizeText(auth?.scope || '', 500) : '',
    connectedAt: connected ? sanitizeText(auth?.connectedAt || '', 80) : ''
  });
});

app.post(['/api/admin/spotify/auth/disconnect', '/api/dj/spotify/auth/disconnect'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  spotifyDjAuthState.auth = null;
  spotifyDjAuthState.oauth = null;
  return res.json({ ok: true });
});

app.get(['/api/admin/spotify/sdk-token', '/api/dj/spotify/sdk-token'], async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tokenResult = await getSpotifyDjUserAccessTokenLocal();
  if (tokenResult.error) {
    return res.status(tokenResult.error.status || 502).json({ error: tokenResult.error.message || 'Spotify token request failed.' });
  }

  const accessToken = sanitizeText(tokenResult.token || '', 600);
  if (!accessToken) {
    return res.status(502).json({ error: 'Spotify token is unavailable.' });
  }

  return res.json({
    accessToken,
    tokenType: sanitizeText(tokenResult.auth?.tokenType || 'Bearer', 40),
    expiresAt: sanitizeText(tokenResult.auth?.expiresAt || '', 80),
    scope: sanitizeText(tokenResult.auth?.scope || '', 500)
  });
});

app.post(['/api/admin/spotify/transfer', '/api/dj/spotify/transfer'], async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const deviceId = normalizeSpotifyDjDeviceIdLocal(req.body?.deviceId || '');
  if (!deviceId) {
    return res.status(400).json({ error: 'A valid Spotify device id is required.' });
  }

  const shouldPlay = Boolean(req.body?.play);
  const result = await requestSpotifyDjApiLocal('/me/player', {
    method: 'PUT',
    body: {
      device_ids: [deviceId],
      play: shouldPlay
    }
  });

  if (result.error) return res.status(result.error.status || 502).json({ error: result.error.message || 'Spotify request failed.' });
  if (!result.response?.ok) return sendSpotifyDjErrorLocal(res, result.response.status, result.payload);
  return res.json({ ok: true, deviceId, play: shouldPlay });
});

app.get(['/api/admin/spotify/devices', '/api/dj/spotify/devices'], async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await requestSpotifyDjApiLocal('/me/player/devices');
  if (result.error) return res.status(result.error.status || 502).json({ error: result.error.message || 'Spotify request failed.' });
  if (!result.response?.ok) return sendSpotifyDjErrorLocal(res, result.response.status, result.payload);

  const devices = Array.isArray(result.payload?.devices) ? result.payload.devices : [];
  return res.json({
    devices: devices.map((device) => ({
      id: sanitizeText(device?.id || '', 220),
      name: sanitizeText(device?.name || '', 200),
      isActive: Boolean(device?.is_active),
      type: sanitizeText(device?.type || '', 80),
      volumePercent: Number(device?.volume_percent ?? 0),
      isRestricted: Boolean(device?.is_restricted)
    })).filter((device) => device.id)
  });
});

app.post(['/api/admin/spotify/play', '/api/dj/spotify/play'], async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const trackUri = normalizeSpotifyDjTrackUriLocal(req.body?.trackUri || req.body?.trackId || '');
  if (!trackUri) return res.status(400).json({ error: 'A valid Spotify track id or uri is required.' });

  const deviceId = normalizeSpotifyDjDeviceIdLocal(req.body?.deviceId || '');
  const path = deviceId
    ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : '/me/player/play';

  const result = await requestSpotifyDjApiLocal(path, {
    method: 'PUT',
    body: { uris: [trackUri] }
  });
  if (result.error) return res.status(result.error.status || 502).json({ error: result.error.message || 'Spotify request failed.' });
  if (!result.response?.ok) return sendSpotifyDjErrorLocal(res, result.response.status, result.payload);

  return res.json({ ok: true, trackUri, deviceId });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
