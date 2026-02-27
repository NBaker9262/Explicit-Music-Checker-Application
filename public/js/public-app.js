const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchStatus = document.getElementById('searchStatus');
const searchResults = document.getElementById('searchResults');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const albumViewBar = document.getElementById('albumViewBar');
const albumBackBtn = document.getElementById('albumBackBtn');
const albumViewTitle = document.getElementById('albumViewTitle');

const requestOverlay = document.getElementById('requestOverlay');
const closeRequestOverlayBtn = document.getElementById('closeRequestOverlayBtn');
const selectedSong = document.getElementById('selectedSong');
const requestForm = document.getElementById('requestForm');
const submitBtn = requestForm.querySelector('button[type="submit"]');
const requesterNameInput = document.getElementById('requesterName');
const requestStatus = document.getElementById('requestStatus');
const queueStatus = document.getElementById('queueStatus');
const approvedList = document.getElementById('approvedList');

const rateLimitModal = document.getElementById('rateLimitModal');
const rateLimitMessage = document.getElementById('rateLimitMessage');
const closeRateLimitModalBtn = document.getElementById('closeRateLimitModalBtn');

let selectedTrack = null;
let cooldownTimer = null;
let searchPageToken = 0;

const REQUEST_COOLDOWN_KEY = 'request_cooldown_until';
const SEARCH_PAGE_SIZE = 24;

const searchState = {
  query: '',
  type: 'all',
  offset: 0,
  hasMore: false,
  loading: false,
  totalLoaded: 0,
  items: [],
  view: 'search',
  albumSnapshot: null
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function confidenceLabel(confidence) {
  if (confidence === 'clean') return 'Clean';
  if (confidence === 'explicit') return 'Explicit';
  return 'Unknown';
}

function normalizeResultKind(item) {
  const rawKind = String(item?.kind || '').toLowerCase();
  if (rawKind === 'album' || rawKind === 'artist') return rawKind;
  return 'track';
}

function renderSelectedTrack() {
  if (!selectedTrack) {
    selectedSong.innerHTML = '';
    return;
  }

  selectedSong.innerHTML = `
    <img src="${escapeHtml(safeImageUrl(selectedTrack.albumImage))}" alt="Album art for ${escapeHtml(selectedTrack.name)}">
    <div>
      <h3>${escapeHtml(selectedTrack.name)}</h3>
      <p>${escapeHtml((selectedTrack.artists || []).join(', '))}</p>
      <p><span class="badge badge-confidence badge-confidence-${escapeHtml(selectedTrack.confidence || 'unknown')}">${escapeHtml(confidenceLabel(selectedTrack.confidence || 'unknown'))}</span></p>
    </div>
  `;
}

function updateLoadMoreButton() {
  if (!loadMoreBtn) return;
  const canPaginate = searchState.view === 'search' && Boolean(searchState.query) && searchState.totalLoaded > 0;
  const shouldShow = canPaginate && (searchState.hasMore || searchState.loading);
  loadMoreBtn.hidden = !shouldShow;
  loadMoreBtn.disabled = searchState.loading || !searchState.hasMore;
  loadMoreBtn.textContent = searchState.loading ? 'Loading...' : 'Load More';
}

function openRequestOverlay() {
  if (!requestOverlay) return;
  requestOverlay.hidden = false;
  document.body.classList.add('modal-open');
  requesterNameInput?.focus();
}

function closeRequestOverlay() {
  selectedTrack = null;
  renderSelectedTrack();
  requestForm.reset();
  setRequestStatus('');
  if (requestOverlay) requestOverlay.hidden = true;
  document.body.classList.remove('modal-open');
}

function chooseTrack(track) {
  selectedTrack = track;
  hideSuggestions();
  renderSelectedTrack();
  requestForm.reset();
  setRequestStatus('');
  updateCooldownUi();
  openRequestOverlay();
}

function hideSuggestions() {
  // Live suggestions removed. Keep no-op for clean call sites.
}

function showAlbumViewBar(title) {
  if (!albumViewBar || !albumViewTitle) return;
  albumViewTitle.textContent = title;
  albumViewBar.hidden = false;
}

function hideAlbumViewBar() {
  if (!albumViewBar || !albumViewTitle) return;
  albumViewTitle.textContent = '';
  albumViewBar.hidden = true;
}

function buildSpotifySearchUrl(query, { type = 'all', limit, offset }) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('type', type);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return window.appApi.buildApiUrl(`/api/public/spotify/search?${params.toString()}`);
}

function searchByArtist(artistName) {
  const artist = String(artistName || '').trim();
  if (!artist) return;
  searchInput.value = artist;
  startSearch({ type: 'all' });
}

function createArtistButtons(artists) {
  const wrapper = document.createElement('p');
  wrapper.className = 'song-artists';

  (artists || []).forEach((artist, index) => {
    if (index > 0) wrapper.appendChild(document.createTextNode(', '));
    const button = document.createElement('button');
    button.className = 'artist-link';
    button.type = 'button';
    button.textContent = String(artist || '');
    button.addEventListener('click', () => searchByArtist(artist));
    wrapper.appendChild(button);
  });

  return wrapper;
}

function createResultCard(item) {
  const kind = normalizeResultKind(item);
  const card = document.createElement('article');
  card.className = 'song-card';

  const coverButton = document.createElement('button');
  coverButton.className = 'song-card-select';
  coverButton.type = 'button';
  coverButton.innerHTML = `<img src="${escapeHtml(safeImageUrl(item.albumImage))}" alt="Cover art for ${escapeHtml(item.name)}">`;

  const body = document.createElement('div');
  body.className = 'song-card-body';

  const titleButton = document.createElement('button');
  titleButton.className = 'song-link';
  titleButton.type = 'button';
  titleButton.textContent = String(item.name || '');

  const kindBadge = document.createElement('p');
  kindBadge.className = 'song-kind';
  kindBadge.textContent = kind === 'album' ? 'Album' : kind === 'artist' ? 'Artist' : 'Song';

  if (kind === 'track') {
    coverButton.addEventListener('click', () => chooseTrack(item));
    titleButton.addEventListener('click', () => chooseTrack(item));
  } else if (kind === 'album') {
    coverButton.addEventListener('click', () => openAlbum(item));
    titleButton.addEventListener('click', () => openAlbum(item));
  } else {
    coverButton.addEventListener('click', () => searchByArtist(item.name));
    titleButton.addEventListener('click', () => searchByArtist(item.name));
  }

  body.appendChild(titleButton);
  body.appendChild(createArtistButtons(item.artists || []));
  body.appendChild(kindBadge);

  card.appendChild(coverButton);
  card.appendChild(body);
  return card;
}

function renderResults(items) {
  searchResults.innerHTML = '';
  if (!items.length) {
    searchResults.innerHTML = '<p class="empty-state">No songs, albums, or artists found.</p>';
    return;
  }

  items.forEach((item) => {
    searchResults.appendChild(createResultCard(item));
  });
}

async function loadSearchPage({ append = false } = {}) {
  if (searchState.loading) return;
  if (selectedTrack) return;
  if (searchState.view !== 'search') return;
  if (!append && !searchState.query) return;
  if (append && !searchState.hasMore) return;

  searchState.loading = true;
  updateLoadMoreButton();
  setSearchStatus(append ? 'Loading more...' : 'Searching...');
  const requestToken = ++searchPageToken;

  try {
    const response = await fetch(buildSpotifySearchUrl(searchState.query, {
      type: searchState.type,
      limit: SEARCH_PAGE_SIZE,
      offset: searchState.offset
    }));
    const payload = await response.json();

    if (requestToken !== searchPageToken) return;
    if (!response.ok) {
      throw new Error(payload.error || 'Search failed');
    }

    const items = payload.items || [];
    if (!append) searchState.items = [];
    searchState.items = [...searchState.items, ...items];
    searchState.totalLoaded = searchState.items.length;
    searchState.offset += SEARCH_PAGE_SIZE;
    searchState.hasMore = Boolean(payload.page?.hasMore) && items.length > 0;

    renderResults(searchState.items);

    if (!searchState.totalLoaded) {
      setSearchStatus('No results.');
      updateLoadMoreButton();
      return;
    }

    setSearchStatus(searchState.hasMore
      ? `${searchState.totalLoaded} result(s). Use Load More for additional songs.`
      : `${searchState.totalLoaded} result(s).`);
    updateLoadMoreButton();
  } catch (error) {
    if (!append) renderResults([]);
    searchState.hasMore = false;
    setSearchStatus(error.message || 'Search failed.', true);
    updateLoadMoreButton();
  } finally {
    searchState.loading = false;
    updateLoadMoreButton();
  }
}

function startSearch({ type = 'all' } = {}) {
  const query = searchInput.value.trim();
  if (!query) {
    setSearchStatus('Enter a song, album, or artist first.', true);
    return;
  }

  hideSuggestions();
  hideAlbumViewBar();

  searchState.query = query;
  searchState.type = type;
  searchState.offset = 0;
  searchState.totalLoaded = 0;
  searchState.items = [];
  searchState.hasMore = true;
  searchState.loading = false;
  searchState.view = 'search';
  searchState.albumSnapshot = null;
  updateLoadMoreButton();

  loadSearchPage({ append: false });
}

async function openAlbum(albumItem) {
  const albumId = String(albumItem?.id || '').trim();
  if (!albumId) return;

  setSearchStatus('Loading album...');
  hideSuggestions();

  const snapshot = {
    query: searchState.query,
    type: searchState.type,
    offset: searchState.offset,
    hasMore: searchState.hasMore,
    totalLoaded: searchState.totalLoaded,
    items: [...searchState.items]
  };

  try {
    const response = await fetch(window.appApi.buildApiUrl(`/api/public/spotify/album/${encodeURIComponent(albumId)}/tracks`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to load album tracks');

    searchState.view = 'album';
    searchState.albumSnapshot = snapshot;
    searchState.items = payload.items || [];
    searchState.hasMore = false;
    searchState.loading = false;

    renderResults(searchState.items);

    const albumName = payload.album?.name || albumItem.name || 'Album';
    showAlbumViewBar(albumName);
    setSearchStatus(`${searchState.items.length} track(s) in ${albumName}.`);
    updateLoadMoreButton();
  } catch (error) {
    setSearchStatus(error.message || 'Unable to load album tracks.', true);
    updateLoadMoreButton();
  }
}

function backFromAlbumView() {
  const snapshot = searchState.albumSnapshot;
  searchState.view = 'search';
  hideAlbumViewBar();

  if (!snapshot) {
    startSearch({ type: 'all' });
    return;
  }

  searchState.query = snapshot.query;
  searchState.type = snapshot.type;
  searchState.offset = snapshot.offset;
  searchState.hasMore = snapshot.hasMore;
  searchState.totalLoaded = snapshot.totalLoaded;
  searchState.items = [...snapshot.items];
  searchState.albumSnapshot = null;

  renderResults(searchState.items);
  setSearchStatus(searchState.hasMore
    ? `${searchState.totalLoaded} result(s). Use Load More for additional songs.`
    : `${searchState.totalLoaded} result(s).`);
  updateLoadMoreButton();
}

function resetToDefaultPage() {
  selectedTrack = null;
  renderSelectedTrack();
  if (requestOverlay) requestOverlay.hidden = true;
  document.body.classList.remove('modal-open');
  requestForm.reset();
  searchInput.value = '';
  searchResults.innerHTML = '';
  hideSuggestions();
  hideAlbumViewBar();
  setRequestStatus('');
  setSearchStatus('');

  searchState.query = '';
  searchState.type = 'all';
  searchState.offset = 0;
  searchState.hasMore = false;
  searchState.loading = false;
  searchState.totalLoaded = 0;
  searchState.items = [];
  searchState.view = 'search';
  searchState.albumSnapshot = null;
  updateLoadMoreButton();
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
      const message = `Request delay active. Please wait ${formatRemaining(seconds)} before submitting another song.`;
      setRequestStatus(message, true);
      showRateLimitModal(message);
      return;
    }

    if (!response.ok) throw new Error(payload.error || 'Request failed');

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
    if (!response.ok) throw new Error(payload.error || 'Unable to load queue');

    renderLiveQueue(payload.items || []);
    setQueueStatus('Live queue is on.');
  } catch (error) {
    setQueueStatus(error.message || 'Unable to load queue.', true);
  }
}

searchBtn.addEventListener('click', () => startSearch({ type: 'all' }));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    startSearch({ type: 'all' });
  }
});
loadMoreBtn?.addEventListener('click', () => {
  loadSearchPage({ append: true });
});

albumBackBtn?.addEventListener('click', backFromAlbumView);
requestForm.addEventListener('submit', submitRequest);
closeRequestOverlayBtn?.addEventListener('click', closeRequestOverlay);
requestOverlay?.addEventListener('click', (event) => {
  if (event.target === requestOverlay) closeRequestOverlay();
});
closeRateLimitModalBtn?.addEventListener('click', hideRateLimitModal);
rateLimitModal?.addEventListener('click', (event) => {
  if (event.target === rateLimitModal) hideRateLimitModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (requestOverlay && !requestOverlay.hidden) closeRequestOverlay();
  if (rateLimitModal && !rateLimitModal.hidden) hideRateLimitModal();
});

loadLiveQueue();
startCooldownTimer();
updateLoadMoreButton();
setInterval(loadLiveQueue, 8000);
