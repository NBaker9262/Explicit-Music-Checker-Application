const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// You store your key or client secret here
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Middleware to get access token (simplified)
async function getToken() {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const data = await res.json();
    return data.access_token;
}

router.get('/search', async (req, res) => {
    const query = req.query.q;
    const token = await getToken();
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,artist,album&limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    res.json(data);
});

module.exports = router;