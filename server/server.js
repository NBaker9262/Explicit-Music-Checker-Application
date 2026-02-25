const express = require('express');
const app = express();
const path = require('path');

const spotifyRoutes = require('./spotify');

const queue = [];
let nextQueueId = 1;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/spotify', spotifyRoutes);

app.get('/api/queue', (req, res) => {
	const statusFilter = req.query.status;

	if (!statusFilter) {
		return res.json({ items: queue });
	}

	const filtered = queue.filter((item) => item.status === statusFilter);
	return res.json({ items: filtered });
});

app.post('/api/queue', (req, res) => {
	const {
		trackId,
		trackName,
		artists,
		albumName,
		albumImage,
		spotifyUrl,
		requesterName,
		customMessage
	} = req.body;

	if (!trackId || !trackName || !Array.isArray(artists) || artists.length === 0 || !requesterName) {
		return res.status(400).json({ error: 'Missing required fields' });
	}

	const item = {
		id: nextQueueId++,
		trackId,
		trackName,
		artists,
		albumName: albumName || '',
		albumImage: albumImage || '',
		spotifyUrl: spotifyUrl || '',
		requesterName,
		customMessage: customMessage || '',
		status: 'pending',
		reviewNote: '',
		submittedAt: new Date().toISOString()
	};

	queue.unshift(item);
	return res.status(201).json(item);
});

app.patch('/api/queue/:id', (req, res) => {
	const itemId = Number(req.params.id);
	const { status, reviewNote } = req.body;

	if (!['pending', 'approved', 'rejected'].includes(status)) {
		return res.status(400).json({ error: 'Invalid status value' });
	}

	const item = queue.find((entry) => entry.id === itemId);
	if (!item) {
		return res.status(404).json({ error: 'Queue item not found' });
	}

	item.status = status;
	item.reviewNote = typeof reviewNote === 'string' ? reviewNote : item.reviewNote;
	item.updatedAt = new Date().toISOString();

	return res.json(item);
});

app.listen(3000, () => console.log('Server running on port 3000'));