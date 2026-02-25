const express = require('express');
const app = express();
const path = require('path');

const spotifyRoutes = require('./spotify');
const youtubeRoutes = require('./youtube');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/spotify', spotifyRoutes);
app.use('/api/youtube', youtubeRoutes);

app.listen(3000, () => console.log('Server running on port 3000'));