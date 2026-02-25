function buildCorsHeaders(request, allowedOrigin) {
  const requestOrigin = request.headers.get('Origin') || '';
  const origin = allowedOrigin === '*' ? '*' : (requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin);

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
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

function normalizeRequestRow(row) {
  return {
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    artists: JSON.parse(row.artists || '[]'),
    albumName: row.album_name || '',
    albumImage: row.album_image || '',
    spotifyUrl: row.spotify_url || '',
    requesterName: row.requester_name,
    customMessage: row.custom_message || '',
    status: row.status,
    reviewNote: row.review_note || '',
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at || null
  };
}

async function handleGetQueue(request, env) {
  const url = new URL(request.url);
  const status = (url.searchParams.get('status') || '').trim();

  let query = 'SELECT * FROM requests';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY id DESC';

  const stmt = env.DB.prepare(query);
  const result = params.length ? await stmt.bind(...params).all() : await stmt.all();
  const items = (result.results || []).map(normalizeRequestRow);

  return json({ items });
}

async function handleCreateQueue(request, env) {
  const body = await request.json();
  const {
    trackId,
    trackName,
    artists,
    albumName,
    albumImage,
    spotifyUrl,
    requesterName,
    customMessage
  } = body;

  if (!trackId || !trackName || !Array.isArray(artists) || artists.length === 0 || !requesterName) {
    return json({ error: 'Missing required fields' }, 400);
  }

  const now = new Date().toISOString();

  const insert = await env.DB.prepare(
    `INSERT INTO requests
      (track_id, track_name, artists, album_name, album_image, spotify_url, requester_name, custom_message, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(
      trackId,
      trackName,
      JSON.stringify(artists),
      albumName || '',
      albumImage || '',
      spotifyUrl || '',
      requesterName,
      customMessage || '',
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

  const body = await request.json();
  const { status, reviewNote } = body;

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json({ error: 'Invalid status value' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM requests WHERE id = ?').bind(itemId).first();
  if (!existing) {
    return json({ error: 'Queue item not found' }, 404);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE requests SET status = ?, review_note = ?, updated_at = ? WHERE id = ?'
  )
    .bind(status, typeof reviewNote === 'string' ? reviewNote : '', now, itemId)
    .run();

  const updated = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(itemId).first();
  return json(normalizeRequestRow(updated));
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
    explicit: Boolean(track.explicit),
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

      if (request.method === 'GET' && url.pathname === '/api/spotify/search') {
        return withCors(await handleSpotifySearch(request, env), corsHeaders);
      }

      return withCors(json({ error: 'Not found' }, 404), corsHeaders);
    } catch (error) {
      return withCors(json({ error: error.message || 'Unhandled error' }, 500), corsHeaders);
    }
  }
};
