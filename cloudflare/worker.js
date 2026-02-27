function parseAllowedOrigins(rawAllowedOrigin) {
  const value = String(rawAllowedOrigin || '*').trim();
  if (!value) {
    return ['*'];
  }
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

function withCors(jsonResponse, corsHeaders) {
  const headers = new Headers(jsonResponse.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(jsonResponse.body, { status: jsonResponse.status, headers });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

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
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return raw;
}

function deriveContentConfidence(explicitFlag) {
  if (explicitFlag === 'explicit') {
    return 'explicit';
  }
  if (explicitFlag === 'clean') {
    return 'clean';
  }
  if (explicitFlag === 'unknown') {
    return 'unknown';
  }
  if (explicitFlag === true || explicitFlag === 1) {
    return 'explicit';
  }
  if (explicitFlag === false || explicitFlag === 0) {
    return 'clean';
  }
  return 'unknown';
}

function parseRequesters(rawJson) {
  try {
    const parsed = JSON.parse(rawJson || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const name = sanitizeText(item.name || '', 80);
        if (!name) {
          return null;
        }
        return {
          name,
          role: normalizeRole(item.role),
          customMessage: sanitizeText(item.customMessage || '', 500),
          submittedAt: sanitizeText(item.submittedAt || '', 40)
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
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

function normalizeRequestRow(row) {
  const requesters = parseRequesters(row.requesters_json);
  const fallbackRequesterName = sanitizeText(row.requester_name || '', 80);
  const fallbackRequesterRole = normalizeRole(row.requester_role || 'guest');

  if (!requesters.length && fallbackRequesterName) {
    requesters.push({
      name: fallbackRequesterName,
      role: fallbackRequesterRole,
      customMessage: sanitizeText(row.custom_message || '', 500),
      submittedAt: sanitizeText(row.submitted_at || '', 40)
    });
  }

  const voteCount = Math.max(1, Number(row.vote_count) || requesters.length || 1);
  const contentConfidence = deriveContentConfidence(
    row.content_confidence || (row.explicit_flag === null || row.explicit_flag === undefined ? null : Number(row.explicit_flag))
  );

  const requesterRoles = requesters.map((requester) => requester.role);
  const priorityScore = Number.isFinite(Number(row.priority_score))
    ? Number(row.priority_score)
    : calculatePriorityScore({
      voteCount,
      requesterRoles,
      eventDate: row.event_date,
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
    requesterName: fallbackRequesterName,
    requesterRole: fallbackRequesterRole,
    requesters,
    customMessage: row.custom_message || '',
    eventDate: row.event_date || null,
    explicit: row.explicit_flag === null || row.explicit_flag === undefined ? null : Boolean(Number(row.explicit_flag)),
    contentConfidence,
    moderationReason: row.moderation_reason || '',
    voteCount,
    priorityScore,
    priorityTier: getPriorityTier(priorityScore),
    status: row.status,
    reviewNote: row.review_note || '',
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || null
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

  const explicitFlag = typeof body.explicit === 'boolean' ? body.explicit : null;
  const contentConfidence = deriveContentConfidence(explicitFlag);

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
    explicitFlag,
    contentConfidence
  };
}

async function handleGetQueue(request, env) {
  const url = new URL(request.url);
  const status = sanitizeText(url.searchParams.get('status'), 20).toLowerCase();

  if (status && !ALLOWED_STATUSES.includes(status)) {
    return json({ error: 'Invalid status filter' }, 400);
  }

  let query = 'SELECT * FROM requests';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ` ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
    priority_score DESC,
    vote_count DESC,
    id DESC`;

  const stmt = env.DB.prepare(query);
  const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
  const items = (result.results || []).map(normalizeRequestRow);

  return json({ items });
}

async function handleCreateQueue(request, env) {
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

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT * FROM requests WHERE track_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
  )
    .bind(payload.trackId)
    .first();

  if (existing) {
    const existingRequesters = parseRequesters(existing.requesters_json);
    existingRequesters.push(
      buildRequesterEntry({
        requesterName: payload.requesterName,
        requesterRole: payload.requesterRole,
        customMessage: payload.customMessage,
        submittedAt: now
      })
    );

    const voteCount = Math.max(Number(existing.vote_count) || 1, existingRequesters.length);
    const mergedEventDate = chooseHigherPriorityEventDate(existing.event_date, payload.eventDate);
    const contentConfidence = existing.content_confidence || payload.contentConfidence;
    const priorityScore = calculatePriorityScore({
      voteCount,
      requesterRoles: existingRequesters.map((entry) => entry.role),
      eventDate: mergedEventDate,
      contentConfidence
    });
    const highestRole = getHighestPriorityRole(existingRequesters.map((entry) => entry.role));

    await env.DB.prepare(
      `UPDATE requests
       SET vote_count = ?,
           requesters_json = ?,
           requester_role = ?,
           event_date = ?,
           explicit_flag = ?,
           content_confidence = ?,
           priority_score = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        voteCount,
        JSON.stringify(existingRequesters),
        highestRole,
        mergedEventDate,
        payload.explicitFlag === null ? existing.explicit_flag : payload.explicitFlag ? 1 : 0,
        contentConfidence,
        priorityScore,
        now,
        existing.id
      )
      .run();

    const merged = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(existing.id).first();
    const normalized = normalizeRequestRow(merged);
    return json({ ...normalized, duplicateJoined: true }, 200);
  }

  const requesters = [
    buildRequesterEntry({
      requesterName: payload.requesterName,
      requesterRole: payload.requesterRole,
      customMessage: payload.customMessage,
      submittedAt: now
    })
  ];

  const voteCount = 1;
  const priorityScore = calculatePriorityScore({
    voteCount,
    requesterRoles: requesters.map((entry) => entry.role),
    eventDate: payload.eventDate,
    contentConfidence: payload.contentConfidence
  });

  const insert = await env.DB.prepare(
    `INSERT INTO requests
      (track_id, track_name, artists, album_name, album_image, spotify_url, requester_name, requester_role, custom_message, event_date,
       explicit_flag, content_confidence, vote_count, requesters_json, priority_score, status, moderation_reason, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?)`
  )
    .bind(
      payload.trackId,
      payload.trackName,
      JSON.stringify(payload.artists),
      payload.albumName,
      payload.albumImage,
      payload.spotifyUrl,
      payload.requesterName,
      payload.requesterRole,
      payload.customMessage,
      payload.eventDate,
      payload.explicitFlag === null ? null : payload.explicitFlag ? 1 : 0,
      payload.contentConfidence,
      voteCount,
      JSON.stringify(requesters),
      priorityScore,
      now
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM requests WHERE id = ?')
    .bind(insert.meta.last_row_id)
    .first();

  return json(normalizeRequestRow(created), 201);
}

async function handleUpdateQueue(request, env, id) {
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return json({ error: 'Invalid queue item id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const status = normalizeStatus(body.status);
  const reviewNote = sanitizeText(body.reviewNote, 500);
  const moderationReason = normalizeModerationReason(body.moderationReason);

  if (!status) {
    return json({ error: 'Invalid status value' }, 400);
  }

  if (moderationReason === null) {
    return json({ error: 'Invalid moderation reason preset' }, 400);
  }

  if (status === 'rejected' && !moderationReason) {
    return json({ error: 'Choose a moderation preset when rejecting a track' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id, moderation_reason FROM requests WHERE id = ?').bind(itemId).first();
  if (!existing) {
    return json({ error: 'Queue item not found' }, 404);
  }

  const resolvedModerationReason = status === 'rejected'
    ? moderationReason || existing.moderation_reason || ''
    : moderationReason || '';

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE requests
     SET status = ?,
         review_note = ?,
         moderation_reason = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(status, reviewNote, resolvedModerationReason, now, itemId)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  return json(normalizeRequestRow(updated));
}

function parseArtists(rawArtists) {
  try {
    const parsed = JSON.parse(rawArtists || '[]');
    return Array.isArray(parsed) ? parsed.map((artist) => sanitizeText(artist, 120)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function handleGetAnalytics(env) {
  const result = await env.DB.prepare(
    'SELECT track_id, track_name, artists, status, vote_count, priority_score, moderation_reason FROM requests'
  ).all();

  const rows = result.results || [];

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

  rows.forEach((row) => {
    const votes = Math.max(1, Number(row.vote_count) || 1);
    const status = normalizeStatus(row.status) || 'pending';

    totalVotes += votes;
    statusBreakdown[status] += votes;

    if (status === 'approved') {
      approvedVotes += votes;
    }

    weightedPrioritySum += (Number(row.priority_score) || 0) * votes;

    parseArtists(row.artists).forEach((artist) => {
      artistVotes.set(artist, (artistVotes.get(artist) || 0) + votes);
    });

    if (status === 'rejected') {
      const key = row.track_id || row.track_name;
      const existing = rejectedTracks.get(key) || {
        trackId: row.track_id || '',
        trackName: row.track_name || 'Unknown',
        rejectedVotes: 0,
        moderationReasons: {}
      };
      existing.rejectedVotes += votes;

      const reason = sanitizeText(row.moderation_reason, 64).toLowerCase();
      if (reason) {
        existing.moderationReasons[reason] = (existing.moderationReasons[reason] || 0) + votes;
        moderationReasonBreakdown.set(reason, (moderationReasonBreakdown.get(reason) || 0) + votes);
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
    .slice(0, 8)
    .map((track) => ({
      trackId: track.trackId,
      trackName: track.trackName,
      rejectedVotes: track.rejectedVotes,
      moderationReasons: track.moderationReasons
    }));

  const moderationReasons = [...moderationReasonBreakdown.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  const approvalRate = totalVotes > 0 ? Number(((approvedVotes / totalVotes) * 100).toFixed(1)) : 0;
  const averagePriorityScore = totalVotes > 0
    ? Number((weightedPrioritySum / totalVotes).toFixed(1))
    : 0;

  return json({
    totals: {
      requests: rows.length,
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
}

async function handleSpotifySearch(request, env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();

  if (!query) {
    return json({ error: 'Search query is required' }, 400);
  }

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return json({ error: 'Spotify credentials are not configured' }, 500);
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
    return json({ error: 'Unable to retrieve Spotify token' }, tokenResponse.status);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return json({ error: 'Spotify token missing in response' }, 500);
  }

  const searchResponse = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=12`,
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    }
  );

  if (!searchResponse.ok) {
    return json({ error: 'Spotify search request failed' }, searchResponse.status);
  }

  const searchData = await searchResponse.json();
  const items = (searchData.tracks?.items || []).map((track) => ({
    id: track.id,
    name: track.name,
    artists: (track.artists || []).map((artist) => artist.name),
    albumName: track.album?.name || '',
    albumImage: track.album?.images?.[0]?.url || '',
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    confidence: deriveContentConfidence(track.explicit),
    previewUrl: track.preview_url || '',
    spotifyUrl: track.external_urls?.spotify || ''
  }));

  return json({ items });
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = buildCorsHeaders(request, allowedOrigin);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), corsHeaders);
    }

    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return withCors(json({ ok: true, service: 'music-queue-api' }), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/queue') {
        return withCors(await handleGetQueue(request, env), corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/queue') {
        return withCors(await handleCreateQueue(request, env), corsHeaders);
      }

      if (request.method === 'PATCH' && url.pathname.startsWith('/api/queue/')) {
        const id = url.pathname.split('/').pop();
        return withCors(await handleUpdateQueue(request, env, id), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/analytics') {
        return withCors(await handleGetAnalytics(env), corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/spotify/search') {
        return withCors(await handleSpotifySearch(request, env), corsHeaders);
      }

      return withCors(json({ error: 'Not found' }, 404), corsHeaders);
    } catch (error) {
      const message = String(error?.message || 'Unhandled error');
      const isMigrationError = /no such column|no such table/i.test(message);
      const status = isMigrationError ? 500 : 500;
      const errorMessage = isMigrationError
        ? 'Database schema is outdated. Run D1 migrations and retry.'
        : message;
      return withCors(json({ error: errorMessage }, status), corsHeaders);
    }
  }
};
