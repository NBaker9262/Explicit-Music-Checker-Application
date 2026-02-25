const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const statusMessage = document.getElementById('statusMessage');
const selectedSong = document.getElementById('selectedSong');
const selectedPanel = document.getElementById('selectedPanel');
const continueBtn = document.getElementById('continueBtn');

let selectedTrack = null;

function renderMessage(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message${isError ? ' error' : ''}`;
}

function renderSelectedTrack() {
    if (!selectedTrack) {
        selectedPanel.hidden = true;
        return;
    }

    selectedPanel.hidden = false;
    selectedSong.innerHTML = `
        <img src="${selectedTrack.albumImage || ''}" alt="Album art for ${selectedTrack.name}">
        <div>
            <h3>${selectedTrack.name}</h3>
            <p>${selectedTrack.artists.join(', ')}</p>
            <p>Album: ${selectedTrack.albumName || 'Unknown'}</p>
            <p>Explicit: ${selectedTrack.explicit ? 'Yes' : 'No'}</p>
        </div>
    `;
}

function selectTrack(track) {
    selectedTrack = track;
    sessionStorage.setItem('selectedTrack', JSON.stringify(track));
    renderSelectedTrack();
}

function renderResults(items) {
    resultsDiv.innerHTML = '';

    if (!items.length) {
        resultsDiv.innerHTML = '<p class="empty-state">No matching songs were found.</p>';
        return;
    }

    items.forEach((track) => {
        const card = document.createElement('article');
        card.className = 'song-card';
        card.innerHTML = `
            <img src="${track.albumImage || ''}" alt="Album art for ${track.name}">
            <div class="song-card-body">
                <h3>${track.name}</h3>
                <p>${track.artists.join(', ')}</p>
                <p>Album: ${track.albumName || 'Unknown'}</p>
                <p>Explicit: ${track.explicit ? 'Yes' : 'No'}</p>
            </div>
            <div class="song-card-actions">
                <button class="btn" type="button">Select Song</button>
            </div>
        `;

        card.querySelector('button').addEventListener('click', () => selectTrack(track));
        resultsDiv.appendChild(card);
    });
}

async function searchSongs() {
    const query = searchInput.value.trim();
    if (!query) {
        renderMessage('Enter a song title or artist before searching.', true);
        return;
    }

    renderMessage('Searching Spotify...');
    resultsDiv.innerHTML = '';

    try {
        const response = await fetch(window.appApi.buildApiUrl(`/api/spotify/search?q=${encodeURIComponent(query)}`));
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Search request failed');
        }

        renderResults(data.items || []);
        renderMessage(`Found ${data.items?.length || 0} songs.`);
    } catch (error) {
        renderMessage(error.message || 'Search failed.', true);
    }
}

searchBtn.addEventListener('click', searchSongs);
searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        searchSongs();
    }
});

continueBtn.addEventListener('click', () => {
    if (!selectedTrack) {
        renderMessage('Select a song before continuing.', true);
        return;
    }

    window.location.href = '/submit.html';
});

const cachedTrack = sessionStorage.getItem('selectedTrack');
if (cachedTrack) {
    try {
        selectedTrack = JSON.parse(cachedTrack);
        renderSelectedTrack();
    } catch (error) {
        sessionStorage.removeItem('selectedTrack');
    }
}