
const express = require('express');
const path = require('path');

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

const queue = [];
let nextQueueId = 1;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
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

function getAdminCredentials() {
  const username = sanitizeText(process.env.ADMIN_USERNAME || 'admin', 80) || 'admin';
  const password = sanitizeText(process.env.ADMIN_PASSWORD || 'D3f3nd3rs', 120) || 'D3f3nd3rs';
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
  if (isAdminAuthorized(req)) return true;
  res.set('WWW-Authenticate', 'Basic realm="Dance Admin"');
  res.status(401).json({ error: 'Admin authorization required' });
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
    const leftStatusRank = left.status === 'pending' ? 0 : left.status === 'approved' ? 1 : 2;
    const rightStatusRank = right.status === 'pending' ? 0 : right.status === 'approved' ? 1 : 2;

    if (leftStatusRank !== rightStatusRank) return leftStatusRank - rightStatusRank;
    if (left.setOrder === null && right.setOrder !== null) return 1;
    if (left.setOrder !== null && right.setOrder === null) return -1;
    if (left.setOrder !== null && right.setOrder !== null && left.setOrder !== right.setOrder) {
      return left.setOrder - right.setOrder;
    }
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    if (right.voteCount !== left.voteCount) return right.voteCount - left.voteCount;
    return right.id - left.id;
  });
}

function buildAnalyticsFromItems(items) {
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
  });

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

app.post('/api/admin/login', (req, res) => {
  const credentials = getAdminCredentials();
  const username = sanitizeText(req.body?.username, 80);
  const password = sanitizeText(req.body?.password, 120);

  if (username !== credentials.username || password !== credentials.password) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  return res.json({
    ok: true,
    username: credentials.username,
    tokenType: 'Basic',
    token: Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
  });
});

app.get('/api/admin/session', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const credentials = getAdminCredentials();
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

  const now = new Date().toISOString();
  const existing = queue.find((item) => item.trackId === payload.trackId && item.status === 'pending');

  if (existing) {
    existing.requesters.push(buildRequesterEntry({
      requesterName: payload.requesterName,
      requesterRole: payload.requesterRole,
      customMessage: payload.customMessage,
      dedicationMessage: payload.dedicationMessage,
      submittedAt: now
    }));

    existing.voteCount = Math.max(existing.voteCount + 1, existing.requesters.length);
    existing.requesterRole = getHighestPriorityRole(existing.requesters.map((requester) => requester.role));
    existing.eventDate = chooseHigherPriorityEventDate(existing.eventDate, payload.eventDate);
    existing.danceMoment = chooseHigherPriorityDanceMoment(existing.danceMoment, payload.danceMoment);
    existing.energyLevel = Math.max(existing.energyLevel, payload.energyLevel);
    existing.vibeTags = mergeVibeTags(existing.vibeTags, payload.vibeTags);
    existing.dedicationMessage = existing.dedicationMessage || payload.dedicationMessage;

    if (existing.explicit === null && payload.explicit !== null) existing.explicit = payload.explicit;
    existing.contentConfidence = deriveContentConfidence(existing.explicit);
    existing.priorityScore = calculatePriorityScore({
      voteCount: existing.voteCount,
      requesterRoles: existing.requesters.map((requester) => requester.role),
      eventDate: existing.eventDate,
      contentConfidence: existing.contentConfidence,
      danceMoment: existing.danceMoment,
      energyLevel: existing.energyLevel
    });
    existing.updatedAt = now;

    return res.json({ ...normalizeQueueItem(existing), duplicateJoined: true });
  }

  const requesters = [buildRequesterEntry({
    requesterName: payload.requesterName,
    requesterRole: payload.requesterRole,
    customMessage: payload.customMessage,
    dedicationMessage: payload.dedicationMessage,
    submittedAt: now
  })];

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
    moderationReason: '',
    voteCount: 1,
    priorityScore: calculatePriorityScore({
      voteCount: 1,
      requesterRoles: [payload.requesterRole],
      eventDate: payload.eventDate,
      contentConfidence: payload.contentConfidence,
      danceMoment: payload.danceMoment,
      energyLevel: payload.energyLevel
    }),
    status: 'pending',
    reviewNote: '',
    djNotes: '',
    setOrder: null,
    submittedAt: now,
    updatedAt: null
  };

  queue.unshift(item);
  return res.status(201).json(normalizeQueueItem(item));
});
app.get(['/api/admin/queue', '/api/queue'], (req, res) => {
  if (!isAdminAuthorized(req)) {
    if (req.path === '/api/admin/queue') {
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

app.patch(['/api/admin/queue/:id', '/api/queue/:id'], (req, res) => {
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
    return res.status(400).json({ error: 'No admin updates were provided' });
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

  item.status = status;
  item.reviewNote = hasReviewNote ? sanitizeText(req.body.reviewNote, 500) : item.reviewNote;
  item.moderationReason = resolvedModerationReason;
  item.danceMoment = hasDanceMoment ? normalizeDanceMoment(req.body.danceMoment) : item.danceMoment;
  item.energyLevel = hasEnergyLevel ? normalizeEnergyLevel(req.body.energyLevel) : item.energyLevel;
  item.djNotes = hasDjNotes ? sanitizeText(req.body.djNotes, 500) : item.djNotes;
  item.setOrder = parsedSetOrder.value;
  item.priorityScore = calculatePriorityScore({
    voteCount: item.voteCount,
    requesterRoles: item.requesters.map((requester) => requester.role),
    eventDate: item.eventDate,
    contentConfidence: item.contentConfidence,
    danceMoment: item.danceMoment,
    energyLevel: item.energyLevel
  });
  item.updatedAt = new Date().toISOString();

  return res.json(normalizeQueueItem(item));
});

app.post('/api/admin/bulk', (req, res) => {
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

app.get(['/api/admin/analytics', '/api/analytics'], (req, res) => {
  if (!requireAdmin(req, res)) return;
  const normalized = queue.map(normalizeQueueItem);
  return res.json(buildAnalyticsFromItems(normalized));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
