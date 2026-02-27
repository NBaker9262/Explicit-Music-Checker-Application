const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const statusMessage = document.getElementById('statusMessage');
const selectedSong = document.getElementById('selectedSong');
const selectedPanel = document.getElementById('selectedPanel');
const continueBtn = document.getElementById('continueBtn');

let selectedTrack = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return '';
  }

  return '';
}

function confidenceFromTrack(track) {
  if (track && typeof track.confidence === 'string') {
    return track.confidence;
  }

  if (track?.explicit === true) {
    return 'explicit';
  }
  if (track?.explicit === false) {
    return 'clean';
  }
  return 'unknown';
}

function confidenceLabel(confidence) {
  if (confidence === 'clean') {
    return 'Clean confidence';
  }
  if (confidence === 'explicit') {
    return 'Explicit confidence';
  }
  return 'Unknown confidence';
}

function renderMessage(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message${isError ? ' error' : ''}`;
}

function renderSelectedTrack() {
  if (!selectedTrack) {
    selectedPanel.hidden = true;
    return;
  }

  const confidence = confidenceFromTrack(selectedTrack);
  const imageUrl = safeImageUrl(selectedTrack.albumImage);

  selectedPanel.hidden = false;
  selectedSong.innerHTML = `
    <img src="${escapeHtml(imageUrl)}" alt="Album art for ${escapeHtml(selectedTrack.name)}">
    <div>
      <h3>${escapeHtml(selectedTrack.name)}</h3>
      <p>${escapeHtml((selectedTrack.artists || []).join(', '))}</p>
      <p>Album: ${escapeHtml(selectedTrack.albumName || 'Unknown')}</p>
      <p>
        Content confidence:
        <span class="badge badge-confidence badge-confidence-${escapeHtml(confidence)}">${escapeHtml(confidenceLabel(confidence))}</span>
      </p>
    </div>
  `;
}

function selectTrack(track) {
  selectedTrack = {
    ...track,
    confidence: confidenceFromTrack(track)
  };

  sessionStorage.setItem('selectedTrack', JSON.stringify(selectedTrack));
  renderSelectedTrack();
}

function renderResults(items) {
  resultsDiv.innerHTML = '';

  if (!items.length) {
    resultsDiv.innerHTML = '<p class="empty-state">No matching songs were found.</p>';
    return;
  }

  items.forEach((track) => {
    const confidence = confidenceFromTrack(track);
    const card = document.createElement('article');
    card.className = 'song-card';
    card.innerHTML = `
      <img src="${escapeHtml(safeImageUrl(track.albumImage))}" alt="Album art for ${escapeHtml(track.name)}">
      <div class="song-card-body">
        <h3>${escapeHtml(track.name)}</h3>
        <p>${escapeHtml((track.artists || []).join(', '))}</p>
        <p>Album: ${escapeHtml(track.albumName || 'Unknown')}</p>
        <p>
          <span class="badge badge-confidence badge-confidence-${escapeHtml(confidence)}">${escapeHtml(confidenceLabel(confidence))}</span>
        </p>
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
  } catch {
    sessionStorage.removeItem('selectedTrack');
  }
}
