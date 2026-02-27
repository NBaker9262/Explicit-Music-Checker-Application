const express = require('express');
const router = express.Router();
const fetchFn = global.fetch || require('node-fetch');

// You store your key or client secret here
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Middleware to get access token (simplified)
async function getToken() {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Spotify credentials are not configured');
    }

    const res = await fetchFn('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
        throw new Error('Unable to retrieve Spotify token');
    }

    const data = await res.json();

    if (!data.access_token) {
        throw new Error('Spotify token missing in response');
    }

    return data.access_token;
}

router.get('/search', async (req, res) => {
    const query = String(req.query.q || '').trim();

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    try {
        const token = await getToken();
        const response = await fetchFn(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=12`,
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Spotify search request failed' });
        }

        const data = await response.json();
        const items = (data.tracks?.items || []).map((track) => ({
            id: track.id,
            name: track.name,
            artists: (track.artists || []).map((artist) => artist.name),
            albumName: track.album?.name || '',
            albumImage: track.album?.images?.[0]?.url || '',
            explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
            confidence: track.explicit === true ? 'explicit' : track.explicit === false ? 'clean' : 'unknown',
            previewUrl: track.preview_url || '',
            spotifyUrl: track.external_urls?.spotify || ''
        }));

        return res.json({ items });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Spotify search failed' });
    }
});

module.exports = router;
