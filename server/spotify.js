const express = require('express');
const router = express.Router();
const fetchFn = global.fetch || require('node-fetch');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeType(rawType) {
  const value = String(rawType || '').trim().toLowerCase();
  if (value === 'track' || value === 'album' || value === 'artist') return value;
  return 'all';
}

function deriveContentConfidence(explicit) {
  if (explicit === true) return 'explicit';
  if (explicit === false) return 'clean';
  return 'unknown';
}

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Spotify credentials are not configured');
  }

  const res = await fetchFn('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    throw new Error('Unable to retrieve Spotify token');
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Spotify token missing in response');
  return data.access_token;
}

function mapTrack(track) {
  return {
    kind: 'track',
    id: track.id,
    name: track.name,
    artists: (track.artists || []).map((artist) => artist.name),
    albumName: track.album?.name || '',
    albumImage: track.album?.images?.[0]?.url || '',
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    confidence: deriveContentConfidence(track.explicit),
    previewUrl: track.preview_url || '',
    spotifyUrl: track.external_urls?.spotify || ''
  };
}

function mapAlbum(album) {
  return {
    kind: 'album',
    id: album.id,
    name: album.name,
    artists: (album.artists || []).map((artist) => artist.name),
    albumName: album.name || '',
    albumImage: album.images?.[0]?.url || '',
    explicit: null,
    confidence: 'unknown',
    previewUrl: '',
    spotifyUrl: album.external_urls?.spotify || '',
    releaseDate: album.release_date || '',
    totalTracks: Number(album.total_tracks || 0)
  };
}

function mapArtist(artist) {
  return {
    kind: 'artist',
    id: artist.id,
    name: artist.name,
    artists: [artist.name],
    albumName: '',
    albumImage: artist.images?.[0]?.url || '',
    explicit: null,
    confidence: 'unknown',
    previewUrl: '',
    spotifyUrl: artist.external_urls?.spotify || '',
    followers: Number(artist.followers?.total || 0)
  };
}

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  try {
    const token = await getToken();
    const type = normalizeType(req.query.type);
    const spotifyType = type === 'all' ? 'track,album,artist' : type;
    const limit = clampNumber(req.query.limit, 1, 50);
    const offset = clampNumber(req.query.offset, 0, 950);

    const response = await fetchFn(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${spotifyType}&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Spotify search request failed' });
    }

    const data = await response.json();

    const tracks = (data.tracks?.items || []).map(mapTrack);
    const albums = (data.albums?.items || []).map(mapAlbum);
    const artists = (data.artists?.items || []).map(mapArtist);

    const trackTotal = Number(data.tracks?.total || 0);
    const albumTotal = Number(data.albums?.total || 0);
    const artistTotal = Number(data.artists?.total || 0);
    const trackHasMore = type !== 'album' && type !== 'artist' && (offset + limit) < trackTotal;
    const albumHasMore = type !== 'track' && type !== 'artist' && (offset + limit) < albumTotal;
    const artistHasMore = type !== 'track' && type !== 'album' && (offset + limit) < artistTotal;

    let items = [];
    if (type === 'track') items = tracks;
    else if (type === 'album') items = albums;
    else if (type === 'artist') items = artists;
    else items = [...tracks, ...albums, ...artists];

    return res.json({
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
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Spotify search failed' });
  }
});

router.get('/album/:id/tracks', async (req, res) => {
  const albumId = sanitizeText(req.params.id, 100);
  if (!albumId) return res.status(400).json({ error: 'Album id is required' });

  try {
    const token = await getToken();
    const albumResponse = await fetchFn(`https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!albumResponse.ok) {
      return res.status(albumResponse.status).json({ error: 'Unable to load album' });
    }

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
      const trackResponse = await fetchFn(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!trackResponse.ok) {
        return res.status(trackResponse.status).json({ error: 'Unable to load album tracks' });
      }

      const page = await trackResponse.json();
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
          previewUrl: track.preview_url || '',
          spotifyUrl: track.external_urls?.spotify || '',
          trackNumber: Number(track.track_number || 0)
        });
      });

      nextUrl = page.next || '';
    }

    return res.json({ album: albumInfo, items: tracks });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Album tracks request failed' });
  }
});

module.exports = router;
