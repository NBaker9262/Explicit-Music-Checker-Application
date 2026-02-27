const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchStatus = document.getElementById('searchStatus');
const searchResults = document.getElementById('searchResults');
const selectedPanel = document.getElementById('selectedPanel');
const selectedSong = document.getElementById('selectedSong');
const requestForm = document.getElementById('requestForm');
const submitBtn = requestForm.querySelector('button[type="submit"]');
const requestStatus = document.getElementById('requestStatus');
const queueStatus = document.getElementById('queueStatus');
const approvedList = document.getElementById('approvedList');
const requesterNameInput = document.getElementById('requesterName');
const rateLimitModal = document.getElementById('rateLimitModal');
const rateLimitMessage = document.getElementById('rateLimitMessage');
const closeRateLimitModalBtn = document.getElementById('closeRateLimitModalBtn');

let selectedTrack = null;
let cooldownTimer = null;

const REQUEST_COOLDOWN_KEY = 'request_cooldown_until';

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

function parseIsoDateMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRemaining(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function showRateLimitModal(message) {
  if (!rateLimitModal || !rateLimitMessage) return;
  rateLimitMessage.textContent = message;
  rateLimitModal.hidden = false;
}

function hideRateLimitModal() {
  if (!rateLimitModal) return;
  rateLimitModal.hidden = true;
}

function getCooldownEndMs() {
  const stored = String(localStorage.getItem(REQUEST_COOLDOWN_KEY) || '').trim();
  return parseIsoDateMs(stored);
}

function setCooldown(nextAllowedAt) {
  const parsed = parseIsoDateMs(nextAllowedAt);
  if (parsed === null) return;
  localStorage.setItem(REQUEST_COOLDOWN_KEY, new Date(parsed).toISOString());
  startCooldownTimer();
}

function clearCooldown() {
  localStorage.removeItem(REQUEST_COOLDOWN_KEY);
}

function updateCooldownUi() {
  const cooldownEndMs = getCooldownEndMs();
  const remainingMs = cooldownEndMs === null ? 0 : cooldownEndMs - Date.now();

  if (remainingMs <= 0) {
    if (submitBtn) submitBtn.disabled = false;
    clearCooldown();
    return false;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  if (submitBtn) submitBtn.disabled = true;
  setRequestStatus(`Please wait ${formatRemaining(remainingSeconds)} before sending another request.`, true);
  return true;
}

function startCooldownTimer() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }

  const active = updateCooldownUi();
  if (!active) return;

  cooldownTimer = setInterval(() => {
    const stillActive = updateCooldownUi();
    if (!stillActive && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      setRequestStatus('');
    }
  }, 1000);
}

function resetToDefaultPage() {
  selectedTrack = null;
  renderSelectedTrack();
  requestForm.reset();
  searchInput.value = '';
  searchResults.innerHTML = '';
  setRequestStatus('');
  setSearchStatus('');
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

function chooseTrack(track) {
  selectedTrack = track;
  renderSelectedTrack();
  setRequestStatus('');
  requestForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function searchByArtist(artistName) {
  const artist = String(artistName || '').trim();
  if (!artist) return;
  searchInput.value = artist;
  searchSongs();
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

    const coverBtn = document.createElement('button');
    coverBtn.className = 'song-card-select';
    coverBtn.type = 'button';
    coverBtn.setAttribute('aria-label', `Select ${track.name}`);
    coverBtn.innerHTML = `<img src="${escapeHtml(safeImageUrl(track.albumImage))}" alt="Album art for ${escapeHtml(track.name)}">`;
    coverBtn.addEventListener('click', () => chooseTrack(track));

    const body = document.createElement('div');
    body.className = 'song-card-body';

    const titleBtn = document.createElement('button');
    titleBtn.className = 'song-link';
    titleBtn.type = 'button';
    titleBtn.textContent = String(track.name || '');
    titleBtn.addEventListener('click', () => chooseTrack(track));

    const artistRow = document.createElement('p');
    artistRow.className = 'song-artists';
    (track.artists || []).forEach((artist, index) => {
      if (index > 0) artistRow.appendChild(document.createTextNode(', '));
      const artistBtn = document.createElement('button');
      artistBtn.className = 'artist-link';
      artistBtn.type = 'button';
      artistBtn.textContent = String(artist || '');
      artistBtn.addEventListener('click', () => searchByArtist(artist));
      artistRow.appendChild(artistBtn);
    });

    body.appendChild(titleBtn);
    body.appendChild(artistRow);

    card.appendChild(coverBtn);
    card.appendChild(body);

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
  hideRateLimitModal();

  if (!selectedTrack) {
    setRequestStatus('Choose a song first.', true);
    return;
  }

  if (updateCooldownUi()) {
    showRateLimitModal('Please wait before sending another request. One request is allowed every 10 minutes.');
    return;
  }

  const requesterName = requesterNameInput.value.trim();
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
    if (response.status === 429) {
      if (payload.nextAllowedAt) setCooldown(payload.nextAllowedAt);
      const seconds = Math.max(1, Number(payload.retryAfterSec) || 0);
      const delayText = formatRemaining(seconds);
      const message = `Request delay active. Please wait ${delayText} before submitting another song.`;
      setRequestStatus(message, true);
      showRateLimitModal(message);
      return;
    }

    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }

    if (payload.nextAllowedAt) setCooldown(payload.nextAllowedAt);
    resetToDefaultPage();
    setSearchStatus('Request sent.');
    showRateLimitModal('Request received. You can submit another song after 10 minutes.');
    await loadLiveQueue();
  } catch (error) {
    setRequestStatus(error.message || 'Request failed.', true);
  }
}

function renderLiveQueue(items) {
  approvedList.innerHTML = '';

  if (!items.length) {
    approvedList.innerHTML = '<p class="empty-state">No songs in queue yet.</p>';
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
    setQueueStatus('Live queue is on.');
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
closeRateLimitModalBtn?.addEventListener('click', hideRateLimitModal);
rateLimitModal?.addEventListener('click', (event) => {
  if (event.target === rateLimitModal) hideRateLimitModal();
});

loadLiveQueue();
startCooldownTimer();
setInterval(loadLiveQueue, 8000);
