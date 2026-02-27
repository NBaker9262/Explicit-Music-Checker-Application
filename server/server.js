const express = require('express');
const path = require('path');

const spotifyRoutes = require('./spotify');

const app = express();

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected'];
const ALLOWED_ROLES = ['guest', 'student', 'staff', 'organizer', 'admin'];
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

const ROLE_WEIGHTS = {
  guest: 4,
  student: 8,
  staff: 14,
  organizer: 22,
  admin: 30
};

const queue = [];
let nextQueueId = 1;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') {
    return '';
  }
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
  if (!normalized) {
    return '';
  }
  return MODERATION_PRESETS.includes(normalized) ? normalized : null;
}

function normalizeIsoDate(dateValue) {
  const raw = sanitizeText(dateValue, 20);
  if (!raw) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return raw;
}

function deriveContentConfidence(explicitFlag) {
  if (explicitFlag === true || explicitFlag === 1 || explicitFlag === 'explicit') {
    return 'explicit';
  }
  if (explicitFlag === false || explicitFlag === 0 || explicitFlag === 'clean') {
    return 'clean';
  }
  return 'unknown';
}

function calculatePriorityScore({ voteCount, requesterRoles, eventDate, contentConfidence }) {
  const safeVoteCount = Math.max(1, Number(voteCount) || 1);
  const voteScore = clampNumber(safeVoteCount * 6, 0, 35);

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

    if (daysUntil <= 2) {
      eventScore = 30;
    } else if (daysUntil <= 7) {
      eventScore = 22;
    } else if (daysUntil <= 14) {
      eventScore = 14;
    } else if (daysUntil <= 30) {
      eventScore = 8;
    } else {
      eventScore = 3;
    }

    if (daysUntil < 0) {
      eventScore = 0;
    }
  }

  const confidence = deriveContentConfidence(contentConfidence);
  const confidenceScore = confidence === 'clean' ? 6 : confidence === 'explicit' ? -8 : 0;

  return clampNumber(Math.round(voteScore + roleScore + eventScore + confidenceScore), 0, 100);
}

function getHighestPriorityRole(requesterRoles) {
  return (requesterRoles || []).reduce((bestRole, role) => {
    const normalizedRole = normalizeRole(role);
    const bestWeight = ROLE_WEIGHTS[bestRole] || 0;
    const normalizedWeight = ROLE_WEIGHTS[normalizedRole] || 0;
    return normalizedWeight > bestWeight ? normalizedRole : bestRole;
  }, 'guest');
}

function getPriorityTier(priorityScore) {
  if (priorityScore >= 70) {
    return 'high';
  }
  if (priorityScore >= 40) {
    return 'medium';
  }
  return 'low';
}

function chooseHigherPriorityEventDate(existingDate, incomingDate) {
  const current = normalizeIsoDate(existingDate);
  const incoming = normalizeIsoDate(incomingDate);

  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  return incoming < current ? incoming : current;
}

function normalizeQueueItem(item) {
  const voteCount = Math.max(1, Number(item.voteCount) || 1);
  const priorityScore = Number.isFinite(Number(item.priorityScore))
    ? Number(item.priorityScore)
    : calculatePriorityScore({
      voteCount,
      requesterRoles: (item.requesters || []).map((requester) => requester.role),
      eventDate: item.eventDate,
      contentConfidence: item.contentConfidence
    });

  return {
    ...item,
    voteCount,
    contentConfidence: deriveContentConfidence(item.contentConfidence),
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    requesters: Array.isArray(item.requesters) ? item.requesters : []
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
  const eventDate = normalizeIsoDate(body.eventDate);
  const explicit = typeof body.explicit === 'boolean' ? body.explicit : null;

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
    eventDate,
    explicit,
    contentConfidence: deriveContentConfidence(explicit)
  };
}

function buildRequesterEntry({ requesterName, requesterRole, customMessage, submittedAt }) {
  return {
    name: requesterName,
    role: requesterRole,
    customMessage: customMessage || '',
    submittedAt
  };
}

function getSortedQueue(items) {
  return [...items].sort((left, right) => {
    const leftStatusRank = left.status === 'pending' ? 0 : left.status === 'approved' ? 1 : 2;
    const rightStatusRank = right.status === 'pending' ? 0 : right.status === 'approved' ? 1 : 2;

    if (leftStatusRank !== rightStatusRank) {
      return leftStatusRank - rightStatusRank;
    }

    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }

    if (right.voteCount !== left.voteCount) {
      return right.voteCount - left.voteCount;
    }

    return right.id - left.id;
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/spotify', spotifyRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'music-queue-api-local' });
});

app.get('/api/queue', (req, res) => {
  const statusFilter = sanitizeText(req.query.status, 20).toLowerCase();
  if (statusFilter && !ALLOWED_STATUSES.includes(statusFilter)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  const items = getSortedQueue(queue)
    .filter((item) => !statusFilter || item.status === statusFilter)
    .map(normalizeQueueItem);

  return res.json({ items });
});

app.post('/api/queue', (req, res) => {
  const payload = buildCreatePayload(req.body || {});
  if (!payload.trackId || !payload.trackName || !payload.artists.length || !payload.requesterName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const now = new Date().toISOString();
  const existing = queue.find((item) => item.trackId === payload.trackId && item.status === 'pending');

  if (existing) {
    existing.requesters.push(
      buildRequesterEntry({
        requesterName: payload.requesterName,
        requesterRole: payload.requesterRole,
        customMessage: payload.customMessage,
        submittedAt: now
      })
    );

    existing.voteCount += 1;
    existing.eventDate = chooseHigherPriorityEventDate(existing.eventDate, payload.eventDate);
    if (existing.explicit === null && payload.explicit !== null) {
      existing.explicit = payload.explicit;
    }

    existing.contentConfidence = deriveContentConfidence(existing.explicit);
    existing.requesterRole = getHighestPriorityRole(existing.requesters.map((requester) => requester.role));
    existing.priorityScore = calculatePriorityScore({
      voteCount: existing.voteCount,
      requesterRoles: existing.requesters.map((requester) => requester.role),
      eventDate: existing.eventDate,
      contentConfidence: existing.contentConfidence
    });
    existing.updatedAt = now;

    return res.json({ ...normalizeQueueItem(existing), duplicateJoined: true });
  }

  const requesters = [
    buildRequesterEntry({
      requesterName: payload.requesterName,
      requesterRole: payload.requesterRole,
      customMessage: payload.customMessage,
      submittedAt: now
    })
  ];

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
    eventDate: payload.eventDate,
    explicit: payload.explicit,
    contentConfidence: payload.contentConfidence,
    moderationReason: '',
    voteCount: 1,
    priorityScore: calculatePriorityScore({
      voteCount: 1,
      requesterRoles: [payload.requesterRole],
      eventDate: payload.eventDate,
      contentConfidence: payload.contentConfidence
    }),
    status: 'pending',
    reviewNote: '',
    submittedAt: now,
    updatedAt: null
  };

  queue.unshift(item);
  return res.status(201).json(normalizeQueueItem(item));
});

app.patch('/api/queue/:id', (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Invalid queue item id' });
  }

  const status = normalizeStatus(req.body?.status);
  const reviewNote = sanitizeText(req.body?.reviewNote, 500);
  const moderationReason = normalizeModerationReason(req.body?.moderationReason);

  if (!status) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  if (moderationReason === null) {
    return res.status(400).json({ error: 'Invalid moderation reason preset' });
  }

  if (status === 'rejected' && !moderationReason) {
    return res.status(400).json({ error: 'Choose a moderation preset when rejecting a track' });
  }

  const item = queue.find((entry) => entry.id === itemId);
  if (!item) {
    return res.status(404).json({ error: 'Queue item not found' });
  }

  item.status = status;
  item.reviewNote = reviewNote;
  item.moderationReason = status === 'rejected'
    ? moderationReason || item.moderationReason || ''
    : moderationReason || '';
  item.updatedAt = new Date().toISOString();

  return res.json(normalizeQueueItem(item));
});

app.get('/api/analytics', (req, res) => {
  const statusBreakdown = {
    pending: 0,
    approved: 0,
    rejected: 0
  };

  const artistVotes = new Map();
  const rejectedTracks = new Map();
  const moderationReasonBreakdown = new Map();

  let totalVotes = 0;
  let approvedVotes = 0;
  let weightedPrioritySum = 0;

  queue.forEach((item) => {
    const normalized = normalizeQueueItem(item);
    const votes = normalized.voteCount;

    totalVotes += votes;
    statusBreakdown[normalized.status] += votes;

    if (normalized.status === 'approved') {
      approvedVotes += votes;
    }

    weightedPrioritySum += normalized.priorityScore * votes;

    normalized.artists.forEach((artist) => {
      artistVotes.set(artist, (artistVotes.get(artist) || 0) + votes);
    });

    if (normalized.status === 'rejected') {
      const key = normalized.trackId || normalized.trackName;
      const existing = rejectedTracks.get(key) || {
        trackId: normalized.trackId,
        trackName: normalized.trackName,
        rejectedVotes: 0,
        moderationReasons: {}
      };
      existing.rejectedVotes += votes;

      if (normalized.moderationReason) {
        existing.moderationReasons[normalized.moderationReason] =
          (existing.moderationReasons[normalized.moderationReason] || 0) + votes;
        moderationReasonBreakdown.set(
          normalized.moderationReason,
          (moderationReasonBreakdown.get(normalized.moderationReason) || 0) + votes
        );
      }

      rejectedTracks.set(key, existing);
    }
  });

  const topRequestedArtists = [...artistVotes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([artist, votes]) => ({ artist, votes }));

  const mostRejectedTracks = [...rejectedTracks.values()]
    .sort((a, b) => b.rejectedVotes - a.rejectedVotes)
    .slice(0, 8);

  const moderationReasons = [...moderationReasonBreakdown.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  const approvalRate = totalVotes > 0 ? Number(((approvedVotes / totalVotes) * 100).toFixed(1)) : 0;
  const averagePriorityScore = totalVotes > 0 ? Number((weightedPrioritySum / totalVotes).toFixed(1)) : 0;

  return res.json({
    totals: {
      requests: queue.length,
      votes: totalVotes,
      approvedVotes,
      approvalRate,
      averagePriorityScore
    },
    statusBreakdown,
    topRequestedArtists,
    mostRejectedTracks,
    moderationReasons
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
