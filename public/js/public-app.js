const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchStatus = document.getElementById('searchStatus');
const searchResults = document.getElementById('searchResults');
const selectedPanel = document.getElementById('selectedPanel');
const selectedSong = document.getElementById('selectedSong');
const requestForm = document.getElementById('requestForm');
const requestStatus = document.getElementById('requestStatus');
const queueStatus = document.getElementById('queueStatus');
const approvedList = document.getElementById('approvedList');

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
  if (!raw) return '';

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    return '';
  }

  return '';
}

function setSearchStatus(message, isError = false) {
  searchStatus.textContent = message;
  searchStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setRequestStatus(message, isError = false) {
  requestStatus.textContent = message;
  requestStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setQueueStatus(message, isError = false) {
  queueStatus.textContent = message;
  queueStatus.className = `status-message${isError ? ' error' : ''}`;
}

function confidenceLabel(confidence) {
  if (confidence === 'clean') return 'Clean';
  if (confidence === 'explicit') return 'Explicit';
  return 'Unknown';
}

function renderSelectedTrack() {
  if (!selectedTrack) {
    selectedPanel.hidden = true;
    return;
  }

  selectedPanel.hidden = false;
  selectedSong.innerHTML = `
    <img src="${escapeHtml(safeImageUrl(selectedTrack.albumImage))}" alt="Album art for ${escapeHtml(selectedTrack.name)}">
    <div>
      <h3>${escapeHtml(selectedTrack.name)}</h3>
      <p>${escapeHtml((selectedTrack.artists || []).join(', '))}</p>
      <p><span class="badge badge-confidence badge-confidence-${escapeHtml(selectedTrack.confidence || 'unknown')}">${escapeHtml(confidenceLabel(selectedTrack.confidence || 'unknown'))}</span></p>
    </div>
  `;
}

function renderSearchResults(items) {
  searchResults.innerHTML = '';

  if (!items.length) {
    searchResults.innerHTML = '<p class="empty-state">No songs found.</p>';
    return;
  }

  items.forEach((track) => {
    const card = document.createElement('article');
    card.className = 'song-card';
    card.innerHTML = `
      <img src="${escapeHtml(safeImageUrl(track.albumImage))}" alt="Album art for ${escapeHtml(track.name)}">
      <div class="song-card-body">
        <h3>${escapeHtml(track.name)}</h3>
        <p>${escapeHtml((track.artists || []).join(', '))}</p>
      </div>
      <div class="song-card-actions">
        <button class="btn" type="button">Choose</button>
      </div>
    `;

    card.querySelector('button').addEventListener('click', () => {
      selectedTrack = track;
      renderSelectedTrack();
      setRequestStatus('Song selected. Enter your name and submit.');
      requestForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    searchResults.appendChild(card);
  });
}

async function searchSongs() {
  const query = searchInput.value.trim();
  if (!query) {
    setSearchStatus('Enter a song or artist first.', true);
    return;
  }

  setSearchStatus('Searching...');
  searchResults.innerHTML = '';

  try {
    const response = await fetch(window.appApi.buildApiUrl(`/api/public/spotify/search?q=${encodeURIComponent(query)}`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Search failed');
    }

    renderSearchResults(payload.items || []);
    setSearchStatus(`Found ${payload.items?.length || 0} result(s).`);
  } catch (error) {
    setSearchStatus(error.message || 'Search failed.', true);
  }
}

async function submitRequest(event) {
  event.preventDefault();

  if (!selectedTrack) {
    setRequestStatus('Choose a song first.', true);
    return;
  }

  const requesterName = document.getElementById('requesterName').value.trim();
  if (!requesterName) {
    setRequestStatus('Your name is required.', true);
    return;
  }

  setRequestStatus('Submitting request...');

  try {
    const response = await fetch(window.appApi.buildApiUrl('/api/public/request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: selectedTrack.id,
        trackName: selectedTrack.name,
        artists: selectedTrack.artists,
        albumName: selectedTrack.albumName,
        albumImage: selectedTrack.albumImage,
        spotifyUrl: selectedTrack.spotifyUrl,
        explicit: typeof selectedTrack.explicit === 'boolean' ? selectedTrack.explicit : null,
        requesterName
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }

    requestForm.reset();
    setRequestStatus('Request submitted.');
    await loadLiveQueue();
  } catch (error) {
    setRequestStatus(error.message || 'Request failed.', true);
  }
}

function renderLiveQueue(items) {
  approvedList.innerHTML = '';

  if (!items.length) {
    approvedList.innerHTML = '<p class="empty-state">No approved songs yet.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'queue-card';
    card.innerHTML = `
      <div class="queue-main">
        <img src="${escapeHtml(safeImageUrl(item.albumImage))}" alt="Album art for ${escapeHtml(item.trackName)}">
        <div>
          <h3>${escapeHtml(item.trackName)}</h3>
          <p>${escapeHtml((item.artists || []).join(', '))}</p>
          <p><span class="badge badge-priority badge-priority-${escapeHtml(item.priorityTier || 'low')}">${escapeHtml(String(item.voteCount || 1))} vote(s)</span></p>
        </div>
      </div>
    `;

    approvedList.appendChild(card);
  });
}

async function loadLiveQueue() {
  try {
    const response = await fetch(window.appApi.buildApiUrl('/api/public/queue?limit=30'));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load queue');
    }

    renderLiveQueue(payload.items || []);
    setQueueStatus(`Live now - updated ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setQueueStatus(error.message || 'Unable to load queue.', true);
  }
}

searchBtn.addEventListener('click', searchSongs);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchSongs();
  }
});

requestForm.addEventListener('submit', submitRequest);

loadLiveQueue();
setInterval(loadLiveQueue, 8000);
