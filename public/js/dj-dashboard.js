
const adminStatusMessage = document.getElementById('adminStatusMessage');
const adminControlStatus = document.getElementById('adminControlStatus');
const approvedQueueList = document.getElementById('approvedQueueList');
const flaggedQueueList = document.getElementById('flaggedQueueList');
const explicitQueueList = document.getElementById('explicitQueueList');

const approvedCountChip = document.getElementById('approvedCountChip');
const flaggedCountChip = document.getElementById('flaggedCountChip');
const explicitCountChip = document.getElementById('explicitCountChip');

const refreshAdminBtn = document.getElementById('refreshAdminBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const playNextBtn = document.getElementById('playNextBtn');
const clearApprovedBtn = document.getElementById('clearApprovedBtn');
const clearFlaggedBtn = document.getElementById('clearFlaggedBtn');
const clearExplicitBtn = document.getElementById('clearExplicitBtn');
const renumberBtn = document.getElementById('renumberBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

const refreshPlaybackBtn = document.getElementById('refreshPlaybackBtn');
const playbackStatus = document.getElementById('playbackStatus');
const nowPlayingTitle = document.getElementById('nowPlayingTitle');
const nowPlayingMeta = document.getElementById('nowPlayingMeta');
const nowPlayingBy = document.getElementById('nowPlayingBy');
const spotifyCountdown = document.getElementById('spotifyCountdown');
const playerArtwork = document.getElementById('playerArtwork');

const spotifyStatus = document.getElementById('spotifyStatus');
const spotifyAuthStatus = document.getElementById('spotifyAuthStatus');
const spotifyConnectBtn = document.getElementById('spotifyConnectBtn');
const spotifyDisconnectBtn = document.getElementById('spotifyDisconnectBtn');
const spotifyStartBtn = document.getElementById('spotifyStartBtn');
const spotifyNextBtn = document.getElementById('spotifyNextBtn');
const spotifyAutoBtn = document.getElementById('spotifyAutoBtn');
const spotifyOpenLink = document.getElementById('spotifyOpenLink');
const spotifyArtwork = document.getElementById('spotifyArtwork');
const spotifyTrackName = document.getElementById('spotifyTrackName');
const spotifyArtistName = document.getElementById('spotifyArtistName');
const spotifySeekRange = document.getElementById('spotifySeekRange');
const spotifyCurrentTime = document.getElementById('spotifyCurrentTime');
const spotifyDuration = document.getElementById('spotifyDuration');
const spotifyPlayPauseBtn = document.getElementById('spotifyPlayPauseBtn');
const spotifyRestartBtn = document.getElementById('spotifyRestartBtn');

const djQuickAddStatus = document.getElementById('djQuickAddStatus');
const djQuickAddInput = document.getElementById('djQuickAddInput');
const djQuickAddSearchBtn = document.getElementById('djQuickAddSearchBtn');
const djQuickAddResults = document.getElementById('djQuickAddResults');

let dragItemId = null;
let allQueueItems = [];
let approvedQueueItems = [];
let djSession = { username: 'DJ' };
let queueRenderSignature = '';

const spotifyState = {
  currentQueueItemId: null,
  currentTrackId: '',
<<<<<<< HEAD
  autoAdvanceEnabled: false,
  advanceTimeout: null,
  countdownInterval: null,
  advanceAtMs: 0,
  activeDurationMs: 0
=======
  connected: false,
  expiresAt: '',
  currentTrackUri: '',
  sdkPromise: null,
  tokenPromise: null,
  player: null,
  deviceId: '',
  sdkReady: false,
  isPaused: true,
  isSeeking: false,
  positionMs: 0,
  durationMs: 0
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
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

function setStatus(message, isError = false) {
  if (!adminStatusMessage) return;
  adminStatusMessage.textContent = message;
  adminStatusMessage.className = `status-message${isError ? ' error' : ''}`;
}

function setControlStatus(message, isError = false) {
  if (!adminControlStatus) return;
  adminControlStatus.textContent = message;
  adminControlStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setPlaybackStatus(message, isError = false) {
  if (!playbackStatus) return;
  playbackStatus.textContent = message;
  playbackStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setSpotifyStatus(message, isError = false) {
  if (!spotifyStatus) return;
  spotifyStatus.textContent = message;
  spotifyStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setQuickAddStatus(message, isError = false) {
  if (!djQuickAddStatus) return;
  djQuickAddStatus.textContent = message;
  djQuickAddStatus.className = `status-message${isError ? ' error' : ''}`;
}

<<<<<<< HEAD
function formatDateTime(value) {
  const parsed = Date.parse(String(value || '').trim());
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

function formatArtists(artists) {
  return Array.isArray(artists) && artists.length ? artists.join(', ') : '-';
}

function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
=======
function setSpotifyAuthHint(message, isError = false) {
  if (!spotifyAuthStatus) return;
  spotifyAuthStatus.textContent = message;
  spotifyAuthStatus.className = `inline-hint${isError ? ' error' : ''}`;
}

function parseSpotifyAuthMessageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const auth = String(params.get('spotifyAuth') || '').trim();
  const reason = String(params.get('reason') || '').trim();
  if (!auth) return null;

  params.delete('spotifyAuth');
  params.delete('reason');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', nextUrl);
  return { auth, reason };
}

function hasRequiredSpotifyScopes(rawScope) {
  const scopeSet = new Set(String(rawScope || '').trim().split(/\s+/).filter(Boolean));
  return scopeSet.has('streaming')
    && scopeSet.has('user-read-email')
    && scopeSet.has('user-read-private')
    && scopeSet.has('user-modify-playback-state');
}

async function spotifyAdminFetchJson(path, options = {}) {
  const response = await window.djAuth.adminFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Spotify request failed.');
  return payload;
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
}

function normalizeSpotifyTrackId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;

  if (value.startsWith('spotify:track:')) {
    const token = value.split(':').pop() || '';
    return /^[A-Za-z0-9]{22}$/.test(token) ? token : '';
  }

  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const trackIndex = parts.indexOf('track');
    if (trackIndex >= 0 && parts[trackIndex + 1]) {
      const token = String(parts[trackIndex + 1]).trim();
      return /^[A-Za-z0-9]{22}$/.test(token) ? token : '';
    }
  } catch {
    return '';
  }

  return '';
}

function normalizeCompareText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}"'`.,!?:;|\/\\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreSpotifyCandidate(queueItem, candidate) {
  const queueTitle = normalizeCompareText(queueItem?.trackName || '');
  const queueArtists = Array.isArray(queueItem?.artists) ? queueItem.artists.map((entry) => normalizeCompareText(entry)) : [];
  const primaryQueueArtist = queueArtists[0] || '';

  const candidateTitle = normalizeCompareText(candidate?.name || '');
  const candidateArtists = Array.isArray(candidate?.artists) ? candidate.artists.map((entry) => normalizeCompareText(entry)) : [];
  const primaryCandidateArtist = candidateArtists[0] || '';

  let score = 0;

  if (queueTitle && candidateTitle) {
    if (queueTitle === candidateTitle) score += 55;
    else if (candidateTitle.includes(queueTitle) || queueTitle.includes(candidateTitle)) score += 22;
  }

  if (primaryQueueArtist && primaryCandidateArtist) {
    if (primaryQueueArtist === primaryCandidateArtist) score += 70;
    else if (primaryCandidateArtist.includes(primaryQueueArtist) || primaryQueueArtist.includes(primaryCandidateArtist)) score += 30;
  }

  if (queueArtists.length && candidateArtists.length) {
    const overlap = queueArtists.filter((artist) => candidateArtists.includes(artist));
    score += overlap.length * 20;
  }

  return score;
}

<<<<<<< HEAD
function buildSpotifyEmbedSrc(trackId) {
  return `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}?utm_source=generator&theme=0&autoplay=1`;
}

function splitQueue(items) {
  return {
    queue: items.filter((item) => item.status === 'approved'),
    flagged: items.filter((item) => item.status === 'pending'),
    explicit: items.filter((item) => item.status === 'rejected')
  };
=======
function formatDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
}

function updateCountChips(sections) {
  if (approvedCountChip) approvedCountChip.textContent = String(sections.queue.length);
  if (flaggedCountChip) flaggedCountChip.textContent = String(sections.flagged.length);
  if (explicitCountChip) explicitCountChip.textContent = String(sections.explicit.length);
}

<<<<<<< HEAD
function getQueueHead() {
  return approvedQueueItems.length ? approvedQueueItems[0] : null;
}

function getQueueItemById(itemId) {
  return allQueueItems.find((item) => item.id === itemId) || null;
}

function statusLabel(status) {
  if (status === 'approved') return 'queue';
  if (status === 'pending') return 'flagged';
  if (status === 'rejected') return 'blocked';
  return status || 'unknown';
}

function createStatusBadge(item) {
  return `<span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>`;
}

function createFilterDetails(item) {
  const summary = escapeHtml(item.filterSummary || 'No filter summary available.');
  const reasonLabel = escapeHtml(item.filterReasonLabel || 'Moderation decision');
  const reasonDetail = escapeHtml(item.filterReasonDetail || item.reviewNote || 'No additional details provided.');
  const reasonCode = escapeHtml(item.moderationReasonCode || item.moderationReason || '');

  return `
    <details class="queue-reason-details">
      <summary>${summary}</summary>
      <p><strong>${reasonLabel}</strong></p>
      <p>${reasonDetail}</p>
      ${reasonCode ? `<p class="queue-reason-code">Code: ${reasonCode}</p>` : ''}
    </details>
  `;
}

function getActionButtons(item) {
  if (item.status === 'approved') {
    return `
      <button class="icon-queue-btn" type="button" data-action="flagged" title="Move to flagged" aria-label="Move to flagged">&#9873;</button>
      <button class="icon-queue-btn icon-queue-danger" type="button" data-action="deny" title="Block song" aria-label="Block song">&#10006;</button>
      <button class="icon-queue-btn icon-queue-danger" type="button" data-action="delete" title="Delete permanently" aria-label="Delete permanently">&#128465;</button>
    `;
  }

  if (item.status === 'pending') {
    return `
      <button class="icon-queue-btn icon-queue-approve" type="button" data-action="approve" title="Approve" aria-label="Approve">&#10003;</button>
      <button class="icon-queue-btn icon-queue-danger" type="button" data-action="deny" title="Block song" aria-label="Block song">&#10006;</button>
      <button class="icon-queue-btn icon-queue-danger" type="button" data-action="delete" title="Delete permanently" aria-label="Delete permanently">&#128465;</button>
    `;
  }

  return `
    <button class="icon-queue-btn icon-queue-approve" type="button" data-action="approve" title="Restore to queue" aria-label="Restore to queue">&#8634;</button>
    <button class="icon-queue-btn icon-queue-danger" type="button" data-action="delete" title="Delete permanently" aria-label="Delete permanently">&#128465;</button>
  `;
}

function createQueueRow(item) {
  const row = document.createElement('article');
  row.className = `queue-row queue-row-${item.status}`;
  row.dataset.itemId = String(item.id);

  const imageUrl = safeImageUrl(item.albumImage);
  const orderLabel = Number.isInteger(item.setOrder) ? `#${item.setOrder}` : '-';

  row.innerHTML = `
    <div class="queue-row-main">
      <img src="${escapeHtml(imageUrl)}" alt="Album art for ${escapeHtml(item.trackName || 'track')}">
      <div>
        <h4>${escapeHtml(item.trackName || 'Unknown track')}</h4>
        <p>${createStatusBadge(item)}</p>
        <p>${escapeHtml(formatArtists(item.artists))}</p>
        <p>Requested by: <strong>${escapeHtml(item.requesterName || '-')}</strong></p>
        ${item.status === 'rejected' ? '' : `<p>Line: <strong>${escapeHtml(orderLabel)}</strong></p>`}
        ${createFilterDetails(item)}
      </div>
    </div>
    <div class="queue-row-controls">
      <span class="drag-label" aria-hidden="true">DRAG</span>
      ${getActionButtons(item)}
    </div>
  `;

  attachRowEvents(row, item);
  return row;
}

function renderSection(listEl, items, emptyMessage) {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!items.length) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  items.forEach((item) => listEl.appendChild(createQueueRow(item)));
}

function animateDroppedRow(itemId) {
  const row = document.querySelector(`.queue-row[data-item-id="${itemId}"]`);
  if (!row) return;
  row.classList.remove('drop-bounce');
  void row.offsetWidth;
  row.classList.add('drop-bounce');
  setTimeout(() => row.classList.remove('drop-bounce'), 300);
}
=======
function formatClock(msValue) {
  const ms = Math.max(0, Number(msValue) || 0);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function setSpotifyArtwork(item) {
  if (!spotifyArtwork) return;
  const imageUrl = safeImageUrl(item?.albumImage || '');
  if (imageUrl) {
    spotifyArtwork.src = imageUrl;
  } else {
    spotifyArtwork.removeAttribute('src');
  }
  spotifyArtwork.alt = `Album art for ${String(item?.trackName || 'current track')}`;
}

function updateSpotifyTransportUi() {
  if (spotifyPlayPauseBtn) {
    spotifyPlayPauseBtn.textContent = spotifyState.isPaused ? '▶' : '⏸';
    spotifyPlayPauseBtn.setAttribute('aria-label', spotifyState.isPaused ? 'Play' : 'Pause');
  }

  if (spotifyCurrentTime) spotifyCurrentTime.textContent = formatClock(spotifyState.positionMs);
  if (spotifyDuration) spotifyDuration.textContent = formatClock(spotifyState.durationMs);

  if (spotifySeekRange && !spotifyState.isSeeking) {
    const max = Math.max(1, spotifyState.durationMs || 1);
    const value = Math.min(max, Math.max(0, spotifyState.positionMs || 0));
    spotifySeekRange.max = String(max);
    spotifySeekRange.value = String(value);
  }
}

function resetSpotifyTransportUi() {
  spotifyState.isPaused = true;
  spotifyState.positionMs = 0;
  spotifyState.durationMs = 0;
  updateSpotifyTransportUi();
}

function renderEmbeddedTrackMeta(item, resolvedUrl) {
  if (spotifyTrackName) spotifyTrackName.textContent = item?.trackName || 'Select a track';
  if (spotifyArtistName) spotifyArtistName.textContent = formatArtists(item?.artists || []);
  setSpotifyArtwork(item);
  if (spotifyOpenLink) {
    spotifyOpenLink.href = resolvedUrl || '#';
  }
}

>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
async function ensureAdminSession() {
  if (!window.djAuth.getAdminToken()) {
    window.location.href = '/dj/login.html';
    return false;
  }

  try {
    const response = await window.djAuth.adminFetch('/api/dj/session');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return false;
    }

    const username = String(payload?.username || '').trim();
    if (username) djSession = { username };
    return true;
  } catch {
    window.djAuth.clearAdminToken();
    window.location.href = '/dj/login.html';
    return false;
  }
}

<<<<<<< HEAD
=======
function splitQueue(items) {
  return {
    queue: items.filter((item) => item.status === 'approved'),
    flagged: items.filter((item) => item.status === 'pending'),
    explicit: items.filter((item) => item.status === 'rejected')
  };
}

function buildQueueSignature(items) {
  const safeItems = Array.isArray(items) ? items : [];
  return JSON.stringify(safeItems.map((item) => ({
    id: item.id,
    status: item.status,
    setOrder: item.setOrder,
    trackName: item.trackName,
    artists: item.artists,
    albumImage: item.albumImage,
    moderationReason: item.moderationReason,
    updatedAt: item.updatedAt || ''
  })));
}

function getQueueHead() {
  return approvedQueueItems.length ? approvedQueueItems[0] : null;
}

function getQueueItemById(itemId) {
  return allQueueItems.find((item) => item.id === itemId) || null;
}

function statusLabel(status) {
  if (status === 'approved') return 'queue';
  if (status === 'pending') return 'review';
  if (status === 'rejected') return 'blocked';
  return status || 'unknown';
}

function createStatusBadge(item) {
  return `<span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>`;
}

function createSongMeta(item) {
  const artists = escapeHtml(formatArtists(item.artists));
  const requester = escapeHtml(item.requesterName || '-');
  const filterSummary = escapeHtml(item.filterSummary || 'Filter summary unavailable.');
  const orderLabel = Number.isInteger(item.setOrder) ? `#${item.setOrder}` : '-';
  const orderLine = item.status === 'rejected' ? '' : `<p>Line: <strong>${escapeHtml(orderLabel)}</strong></p>`;

  return `
    <p>${artists}</p>
    <p>Requested by: <strong>${requester}</strong></p>
    <p class="filter-summary">${filterSummary}</p>
    ${orderLine}
  `;
}

function getActionButtons(item) {
  if (item.status === 'approved') {
    return `
      <button class="btn" type="button" data-action="flagged">Review</button>
      <button class="btn btn-danger" type="button" data-action="deny">Block</button>
    `;
  }

  if (item.status === 'pending') {
    return `
      <button class="btn btn-primary" type="button" data-action="approve">Approve</button>
      <button class="btn btn-danger" type="button" data-action="deny">Block</button>
    `;
  }

  return `
    <button class="btn btn-primary" type="button" data-action="approve">Restore</button>
  `;
}

function animateDroppedRow(itemId) {
  const row = document.querySelector(`.queue-row[data-item-id="${itemId}"]`);
  if (!row) return;
  row.classList.remove('drop-bounce');
  void row.offsetWidth;
  row.classList.add('drop-bounce');
  setTimeout(() => row.classList.remove('drop-bounce'), 300);
}

>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
async function callControlAction(action, extraPayload = {}) {
  const response = await window.djAuth.adminFetch('/api/dj/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      playedBy: djSession.username || 'DJ',
      ...extraPayload
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.djAuth.clearAdminToken();
    window.location.href = '/dj/login.html';
    return null;
  }

  if (!response.ok) throw new Error(payload.error || 'Control action failed');
  return payload;
}

async function updateStatus(itemId, status, moderationReason, { reload = true } = {}) {
  setStatus('Saving...');

  const payload = status === 'rejected'
    ? { status, moderationReason: moderationReason || 'other' }
    : { status, moderationReason: '' };

  const response = await window.djAuth.adminFetch(`/api/dj/queue/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(result.error || 'Unable to update song');

  setStatus(`Updated: ${result.trackName || 'song'}`);
  if (reload) await loadQueue();
}

async function deleteQueueItem(itemId) {
  const item = getQueueItemById(itemId);
  const label = item?.trackName || `#${itemId}`;
  const confirmed = window.confirm(`Delete "${label}" permanently from queue data?`);
  if (!confirmed) return;

  setStatus('Deleting song...');
  const response = await window.djAuth.adminFetch(`/api/dj/queue/${itemId}`, { method: 'DELETE' });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || 'Unable to delete song');

  setStatus(`Deleted: ${payload.trackName || label}`);
  await loadQueue({ silent: true });
}

async function reorderQueue(itemId, beforeId, { reload = true } = {}) {
  setStatus('Updating order...');
  const response = await window.djAuth.adminFetch('/api/dj/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, beforeId })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to reorder queue');

  setStatus('Queue order updated.');
  if (reload) await loadQueue({ silent: true });
}

async function moveDraggedItem(targetStatus, beforeId = null) {
  if (dragItemId === null) return;

  const sourceItem = getQueueItemById(dragItemId);
  if (!sourceItem) return;

  if (sourceItem.status === targetStatus) {
    if (targetStatus !== 'rejected') {
      await reorderQueue(dragItemId, beforeId, { reload: true });
      animateDroppedRow(dragItemId);
    }
    return;
  }

  const reason = targetStatus === 'rejected' ? 'explicit_lyrics' : '';
  await updateStatus(dragItemId, targetStatus, reason, { reload: false });
  if (targetStatus !== 'rejected' && beforeId !== null) {
    await reorderQueue(dragItemId, beforeId, { reload: false });
  }

  await loadQueue({ silent: true });
  animateDroppedRow(dragItemId);
}

function attachRowEvents(row, item) {
  const approveBtn = row.querySelector('[data-action="approve"]');
  const flaggedBtn = row.querySelector('[data-action="flagged"]');
  const denyBtn = row.querySelector('[data-action="deny"]');
  const deleteBtn = row.querySelector('[data-action="delete"]');

  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      try {
        await updateStatus(item.id, 'approved', '');
      } catch (error) {
        setStatus(error.message || 'Unable to update song.', true);
      }
    });
  }

  if (flaggedBtn) {
    flaggedBtn.addEventListener('click', async () => {
      try {
        await updateStatus(item.id, 'pending', '');
      } catch (error) {
        setStatus(error.message || 'Unable to update song.', true);
      }
    });
  }

  if (denyBtn) {
    denyBtn.addEventListener('click', async () => {
      try {
        await updateStatus(item.id, 'rejected', 'explicit_lyrics');
      } catch (error) {
        setStatus(error.message || 'Unable to update song.', true);
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await deleteQueueItem(item.id);
      } catch (error) {
        setStatus(error.message || 'Unable to delete song.', true);
      }
    });
  }

  row.draggable = true;
  row.classList.add('draggable-row');

  row.addEventListener('dragstart', (event) => {
    dragItemId = item.id;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(item.id));
    document.body.classList.add('drag-active');
  });

  row.addEventListener('dragend', () => {
    dragItemId = null;
    row.classList.remove('dragging');
    document.body.classList.remove('drag-active');
    document.querySelectorAll('.drop-target, .drop-target-list').forEach((entry) => {
      entry.classList.remove('drop-target');
      entry.classList.remove('drop-target-list');
    });
  });

  row.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (dragItemId === null || dragItemId === item.id) return;
    row.classList.add('drop-target');
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-target');
  });

  row.addEventListener('drop', async (event) => {
    event.preventDefault();
    row.classList.remove('drop-target');
    if (dragItemId === null || dragItemId === item.id) return;
    try {
      await moveDraggedItem(item.status, item.id);
    } catch (error) {
      setStatus(error.message || 'Unable to move song.', true);
    }
  });
}

<<<<<<< HEAD
=======
function createQueueRow(item) {
  const row = document.createElement('article');
  row.className = `queue-row queue-row-${item.status}`;
  row.dataset.itemId = String(item.id);
  const albumImage = safeImageUrl(item.albumImage) || '/ALA-Defenders-Mascot.webp';

  const pendingNote = item.status === 'pending'
    ? '<p class="pending-note">Review lane tracks stay out of playback until approved.</p>'
    : '';

  const deniedReason = item.status === 'rejected' && item.moderationReason
    ? `<p class="pending-note">Reason: ${escapeHtml(item.moderationReason)}</p>`
    : '';

  row.innerHTML = `
    <div class="queue-row-main">
      <img src="${escapeHtml(albumImage)}" decoding="async" alt="Album art for ${escapeHtml(item.trackName)}">
      <div>
        <h4>${escapeHtml(item.trackName)}</h4>
        <p>${createStatusBadge(item)}</p>
        ${createSongMeta(item)}
        ${pendingNote}
        ${deniedReason}
      </div>
    </div>
    <div class="queue-row-controls">
      <span class="drag-label" aria-hidden="true">⋮⋮</span>
      ${getActionButtons(item)}
    </div>
  `;

  attachRowEvents(row, item);
  const albumArt = row.querySelector('img');
  albumArt?.addEventListener('error', () => {
    if (albumArt.getAttribute('src') === '/ALA-Defenders-Mascot.webp') return;
    albumArt.setAttribute('src', '/ALA-Defenders-Mascot.webp');
  });
  return row;
}

function renderSection(listEl, items, emptyMessage) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  items.forEach((item) => listEl.appendChild(createQueueRow(item)));
}

>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
function enableListDrop(listEl, targetStatus) {
  if (!listEl) return;

  listEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (dragItemId === null) return;
    listEl.classList.add('drop-target-list');
  });

  listEl.addEventListener('dragleave', () => {
    listEl.classList.remove('drop-target-list');
  });

  listEl.addEventListener('drop', async (event) => {
    event.preventDefault();
    listEl.classList.remove('drop-target-list');
    if (dragItemId === null) return;
    try {
      await moveDraggedItem(targetStatus, null);
    } catch (error) {
      setStatus(error.message || 'Unable to move song.', true);
    }
  });
}

function clearPlaybackTimers() {
  if (spotifyState.advanceTimeout) {
    clearTimeout(spotifyState.advanceTimeout);
    spotifyState.advanceTimeout = null;
  }
  if (spotifyState.countdownInterval) {
    clearInterval(spotifyState.countdownInterval);
    spotifyState.countdownInterval = null;
  }
  spotifyState.advanceAtMs = 0;
}

function updateAutoButtonState() {
  if (!spotifyAutoBtn) return;
  spotifyAutoBtn.classList.toggle('is-active', spotifyState.autoAdvanceEnabled);
  spotifyAutoBtn.setAttribute('aria-pressed', spotifyState.autoAdvanceEnabled ? 'true' : 'false');
}

function updateCountdownLabel(message) {
  if (!spotifyCountdown) return;
  spotifyCountdown.textContent = message;
}

function scheduleAutoAdvance(durationMs) {
  clearPlaybackTimers();
  spotifyState.activeDurationMs = Math.max(0, Number(durationMs) || 0);

  if (!spotifyState.autoAdvanceEnabled) {
    updateCountdownLabel('Auto-advance: off');
    return;
  }

  if (!spotifyState.currentQueueItemId || spotifyState.activeDurationMs <= 0) {
    updateCountdownLabel('Auto-advance: waiting for track length');
    return;
  }

  const startQueueItemId = spotifyState.currentQueueItemId;
  const advanceDelay = spotifyState.activeDurationMs + 2000;
  spotifyState.advanceAtMs = Date.now() + advanceDelay;

  spotifyState.advanceTimeout = setTimeout(async () => {
    if (spotifyState.currentQueueItemId !== startQueueItemId) return;
    await advanceSpotifyQueue();
  }, advanceDelay);

  spotifyState.countdownInterval = setInterval(() => {
    const remainingMs = Math.max(0, spotifyState.advanceAtMs - Date.now());
    updateCountdownLabel(`Auto-advance in ${formatDurationMs(remainingMs)}`);
    if (remainingMs <= 0) {
      clearPlaybackTimers();
      updateCountdownLabel('Auto-advance running...');
    }
  }, 1000);

  updateCountdownLabel(`Auto-advance in ${formatDurationMs(advanceDelay)}`);
}

function syncQueueState(items) {
  approvedQueueItems = Array.isArray(items) ? [...items] : [];

  if (spotifyState.currentQueueItemId !== null) {
    const stillExists = approvedQueueItems.some((item) => item.id === spotifyState.currentQueueItemId);
    if (!stillExists) {
      spotifyState.currentQueueItemId = null;
      spotifyState.currentTrackId = '';
<<<<<<< HEAD
      clearPlaybackTimers();
      if (spotifyPlayerFrame) spotifyPlayerFrame.src = 'about:blank';
      if (spotifyOpenLink) spotifyOpenLink.href = '#';
      if (playerArtwork) {
        playerArtwork.src = '';
        playerArtwork.alt = 'Current track artwork';
      }
      updateCountdownLabel('Auto-advance: waiting for queue');
=======
      spotifyState.currentTrackUri = '';
      if (spotifyOpenLink) spotifyOpenLink.href = '#';
      if (spotifyTrackName) spotifyTrackName.textContent = 'Select a track';
      if (spotifyArtistName) spotifyArtistName.textContent = 'Queue playlist';
      setSpotifyArtwork(null);
      resetSpotifyTransportUi();
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
    }
  }
}

async function loadQueue({ silent = false } = {}) {
  if (!silent) setStatus('Loading queue...');

  const response = await window.djAuth.adminFetch('/api/dj/queue');
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    window.djAuth.clearAdminToken();
    window.location.href = '/dj/login.html';
    return;
  }
  if (!response.ok) throw new Error(payload.error || 'Unable to load queue');

  const items = Array.isArray(payload.items) ? payload.items : [];
  allQueueItems = items;

  const sections = splitQueue(items);
<<<<<<< HEAD
  renderSection(approvedQueueList, sections.queue, 'No songs in queue.');
  renderSection(flaggedQueueList, sections.flagged, 'No songs flagged for review.');
  renderSection(explicitQueueList, sections.explicit, 'No blocked songs.');
  updateCountChips(sections);
=======
  const nextSignature = buildQueueSignature(items);
  if (queueRenderSignature !== nextSignature) {
    renderSection(approvedQueueList, sections.queue, 'No songs in queue.');
    renderSection(flaggedQueueList, sections.flagged, 'No songs in review.');
    renderSection(explicitQueueList, sections.explicit, 'No blocked songs.');
    queueRenderSignature = nextSignature;
  }
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
  syncQueueState(sections.queue);

  if (!silent) setStatus(`Queue loaded. ${items.length} total songs.`);
}
function buildQuickAddRequestPayload(track) {
  return {
    trackId: String(track.id || ''),
    trackName: String(track.name || ''),
    artists: Array.isArray(track.artists) ? track.artists : [],
    albumName: String(track.albumName || ''),
    albumImage: String(track.albumImage || ''),
    spotifyUrl: String(track.spotifyUrl || ''),
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    requesterName: djSession.username || 'DJ',
    requesterRole: 'dj'
  };
}

function renderQuickAddResults(items) {
  if (!djQuickAddResults) return;
  djQuickAddResults.innerHTML = '';

  if (!items.length) {
    djQuickAddResults.innerHTML = '<p class="empty-state">No songs found.</p>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'song-card';
    const imageUrl = safeImageUrl(item.albumImage) || '/ALA-Defenders-Mascot.webp';

    card.innerHTML = `
      <img class="quick-add-cover" src="${escapeHtml(imageUrl)}" decoding="async" alt="Cover art for ${escapeHtml(item.name)}">
      <div class="song-card-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(formatArtists(item.artists))}</p>
        <button class="btn btn-primary" type="button">Add</button>
      </div>
    `;
    const cover = card.querySelector('.quick-add-cover');
    cover?.addEventListener('error', () => {
      if (cover.getAttribute('src') === '/ALA-Defenders-Mascot.webp') return;
      cover.setAttribute('src', '/ALA-Defenders-Mascot.webp');
    });

    card.querySelector('button')?.addEventListener('click', async () => {
      setQuickAddStatus(`Adding "${item.name}"...`);
      try {
        const response = await window.djAuth.adminFetch('/api/public/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildQuickAddRequestPayload(item))
        });

        const payload = await response.json().catch(() => ({}));
        if (response.status === 409 && payload.code === 'duplicate_active') {
          throw new Error('This song is already in queue/review.');
        }
        if (!response.ok) throw new Error(payload.error || 'Unable to add song');

        setQuickAddStatus(`Added "${payload.trackName}" as ${payload.status}. ${payload.filterSummary || ''}`);
        await loadQueue({ silent: true });
      } catch (error) {
        setQuickAddStatus(error.message || 'Unable to add song.', true);
      }
    });

    djQuickAddResults.appendChild(card);
  });
}

async function searchQuickAddSongs() {
  const query = String(djQuickAddInput?.value || '').trim();
  if (!query) {
    setQuickAddStatus('Enter a song title or artist first.', true);
    return;
  }

  if (djQuickAddSearchBtn) djQuickAddSearchBtn.disabled = true;
  setQuickAddStatus('Searching...');

  try {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('type', 'track');
    params.set('limit', '12');
    params.set('offset', '0');

    const response = await fetch(window.appApi.buildApiUrl(`/api/public/spotify/search?${params.toString()}`));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to search songs');

    const items = Array.isArray(payload.items) ? payload.items.filter((item) => item.kind === 'track') : [];
    renderQuickAddResults(items);
    setQuickAddStatus(items.length ? `Found ${items.length} songs.` : 'No songs found.');
  } catch (error) {
    renderQuickAddResults([]);
    setQuickAddStatus(error.message || 'Unable to search songs.', true);
  } finally {
    if (djQuickAddSearchBtn) djQuickAddSearchBtn.disabled = false;
  }
}

function renderPlaybackSnapshot(snapshot) {
  const nowPlaying = snapshot?.nowPlaying || null;

  if (nowPlaying && nowPlaying.trackName) {
    if (nowPlayingTitle) nowPlayingTitle.textContent = nowPlaying.trackName;
    if (nowPlayingMeta) nowPlayingMeta.textContent = formatArtists(nowPlaying.artists || []);
    if (nowPlayingBy) nowPlayingBy.textContent = `Played by: ${nowPlaying.playedBy || '-'} at ${formatDateTime(nowPlaying.playedAt)}`;

    if (playerArtwork) {
      const imageUrl = safeImageUrl(nowPlaying.albumImage);
      playerArtwork.src = imageUrl;
      playerArtwork.alt = nowPlaying.trackName ? `Artwork for ${nowPlaying.trackName}` : 'Current track artwork';
    }
  } else {
    if (nowPlayingTitle) nowPlayingTitle.textContent = 'No track active';
    if (nowPlayingMeta) nowPlayingMeta.textContent = 'Start queue playback to load song details.';
    if (nowPlayingBy) nowPlayingBy.textContent = 'Played by: -';
    if (playerArtwork) {
      playerArtwork.src = '';
      playerArtwork.alt = 'Current track artwork';
    }
  }
}

async function loadPlaybackSnapshot({ silent = false } = {}) {
  if (!silent) setPlaybackStatus('Loading playback data...');
  try {
    const response = await window.djAuth.adminFetch('/api/dj/playback?limit=10');
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return;
    }

    if (!response.ok) throw new Error(payload.error || 'Unable to load playback');
    renderPlaybackSnapshot(payload);
    if (!silent) setPlaybackStatus('Playback data loaded.');
  } catch (error) {
    if (!silent) setPlaybackStatus(error.message || 'Unable to load playback data.', true);
  }
}

<<<<<<< HEAD
async function persistNowPlayingFromTrack(item, resolvedSpotifyUrl) {
=======
async function persistNowPlayingFromTrack(item, overrides = {}) {
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
  try {
    await window.djAuth.adminFetch('/api/dj/playback/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: String(overrides.trackId || item.trackId || ''),
        trackName: item.trackName || '',
        artists: item.artists || [],
        albumImage: item.albumImage || '',
<<<<<<< HEAD
        spotifyUrl: resolvedSpotifyUrl || item.spotifyUrl || '',
=======
        spotifyUrl: String(overrides.spotifyUrl || item.spotifyUrl || ''),
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
        playedBy: djSession.username || 'DJ',
        source: String(overrides.source || 'spotify_playback_sdk')
      })
    });
    await loadPlaybackSnapshot({ silent: true });
  } catch {
    // best effort
  }
}

<<<<<<< HEAD
=======
function getSpotifyTrackIdFromQueueItem(item) {
  const fromUrl = normalizeSpotifyTrackId(item?.spotifyUrl || '');
  if (fromUrl) return fromUrl;
  return normalizeSpotifyTrackId(item?.trackId || '');
}

async function loadSpotifySdkScript() {
  if (window.Spotify && typeof window.Spotify.Player === 'function') {
    return window.Spotify;
  }
  if (spotifyState.sdkPromise) return spotifyState.sdkPromise;

  spotifyState.sdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Spotify Web Playback SDK timed out while loading.'));
    }, 12000);

    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      resolve(window.Spotify);
    };

    const existingScript = document.querySelector('script[data-spotify-web-playback-sdk="true"]');
    if (existingScript) return;

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.dataset.spotifyWebPlaybackSdk = 'true';
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Failed to load Spotify Web Playback SDK.'));
    };
    document.head.appendChild(script);
  });

  return spotifyState.sdkPromise;
}

async function fetchSpotifySdkToken() {
  const payload = await spotifyAdminFetchJson('/api/dj/spotify/sdk-token');
  const token = String(payload.accessToken || '').trim();
  if (!token) throw new Error('Spotify SDK token is missing.');
  return token;
}

async function transferSpotifyPlayback(deviceId) {
  const targetDeviceId = String(deviceId || '').trim();
  if (!targetDeviceId) throw new Error('Spotify browser player device id is missing.');
  await spotifyAdminFetchJson('/api/dj/spotify/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: targetDeviceId, play: false })
  });
}

async function ensureSpotifyWebPlayer() {
  if (spotifyState.player && spotifyState.sdkReady) return spotifyState.player;
  if (!spotifyState.connected) {
    throw new Error('Connect Spotify first.');
  }

  await loadSpotifySdkScript();
  if (spotifyState.player) return spotifyState.player;

  spotifyState.player = new window.Spotify.Player({
    name: 'DJ Browser Player',
    volume: 0.88,
    getOAuthToken: async (callback) => {
      try {
        const token = await fetchSpotifySdkToken();
        callback(token);
      } catch {
        callback('');
      }
    }
  });

  spotifyState.player.addListener('ready', async ({ device_id: deviceId }) => {
    spotifyState.deviceId = String(deviceId || '').trim();
    spotifyState.sdkReady = Boolean(spotifyState.deviceId);
    try {
      await transferSpotifyPlayback(spotifyState.deviceId);
      setSpotifyStatus('Spotify browser player is ready.');
    } catch (error) {
      setSpotifyStatus(error.message || 'Spotify browser player is ready, but transfer failed.', true);
    }
  });

  spotifyState.player.addListener('not_ready', ({ device_id: deviceId }) => {
    if (spotifyState.deviceId === String(deviceId || '').trim()) {
      spotifyState.sdkReady = false;
    }
  });

  spotifyState.player.addListener('player_state_changed', (state) => {
    if (!state) return;
    spotifyState.isPaused = Boolean(state.paused);
    spotifyState.positionMs = Math.max(0, Number(state.position) || 0);
    spotifyState.durationMs = Math.max(0, Number(state.duration) || 0);

    const currentTrack = state.track_window?.current_track || null;
    if (currentTrack?.uri) {
      spotifyState.currentTrackUri = String(currentTrack.uri || '');
      const uriTrackId = normalizeSpotifyTrackId(currentTrack.uri);
      if (uriTrackId) spotifyState.currentTrackId = uriTrackId;
      if (spotifyTrackName) spotifyTrackName.textContent = String(currentTrack.name || spotifyTrackName.textContent || 'Now Playing');
      if (spotifyArtistName) {
        const artists = Array.isArray(currentTrack.artists) ? currentTrack.artists.map((entry) => String(entry?.name || '').trim()).filter(Boolean) : [];
        spotifyArtistName.textContent = artists.length ? artists.join(', ') : (spotifyArtistName.textContent || '-');
      }
      const imageUrl = safeImageUrl(currentTrack.album?.images?.[0]?.url || '');
      if (spotifyArtwork && imageUrl) spotifyArtwork.src = imageUrl;
      if (spotifyOpenLink && spotifyState.currentTrackId) {
        spotifyOpenLink.href = `https://open.spotify.com/track/${spotifyState.currentTrackId}`;
      }
    }

    if (!spotifyState.isSeeking) updateSpotifyTransportUi();
  });

  spotifyState.player.addListener('authentication_error', ({ message }) => {
    setSpotifyStatus(`Spotify auth error: ${message || 'unknown error'}. Reconnect Spotify.`, true);
    spotifyState.connected = false;
    setSpotifyAuthHint('Spotify account not connected.', true);
  });
  spotifyState.player.addListener('account_error', ({ message }) => {
    setSpotifyStatus(message || 'Spotify account is not eligible for Web Playback SDK.', true);
  });
  spotifyState.player.addListener('playback_error', ({ message }) => {
    setSpotifyStatus(message || 'Spotify playback failed.', true);
  });

  const connected = await spotifyState.player.connect();
  if (!connected) {
    spotifyState.player = null;
    spotifyState.sdkReady = false;
    throw new Error('Could not connect Spotify browser player.');
  }

  if (!spotifyState.deviceId) {
    const startedAt = Date.now();
    while (!spotifyState.deviceId && (Date.now() - startedAt) < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  return spotifyState.player;
}

async function loadSpotifyAuthStatus() {
  try {
    const payload = await spotifyAdminFetchJson('/api/dj/spotify/auth/status');
    spotifyState.connected = Boolean(payload.connected);
    spotifyState.expiresAt = String(payload.expiresAt || '');
    const scope = String(payload.scope || '');
    const scopeOk = hasRequiredSpotifyScopes(scope);
    if (spotifyState.connected) {
      if (scopeOk) {
        setSpotifyAuthHint('Spotify account connected.');
      } else {
        setSpotifyAuthHint('Connected account is missing streaming scopes. Reconnect Spotify.', true);
      }
      if (spotifyDisconnectBtn) spotifyDisconnectBtn.disabled = false;
      if (spotifyConnectBtn) spotifyConnectBtn.disabled = false;
    } else {
      setSpotifyAuthHint('Spotify account not connected.');
      if (spotifyDisconnectBtn) spotifyDisconnectBtn.disabled = true;
    }
  } catch (error) {
    setSpotifyAuthHint(error.message || 'Unable to check Spotify auth status.', true);
  }
}

async function startSpotifyConnect() {
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const payload = await spotifyAdminFetchJson(`/api/dj/spotify/auth/start?returnTo=${encodeURIComponent(returnTo)}`);
  const authorizeUrl = String(payload.authorizeUrl || '').trim();
  if (!authorizeUrl) throw new Error('Spotify authorization URL was not returned.');
  window.location.assign(authorizeUrl);
}

async function disconnectSpotify() {
  await spotifyAdminFetchJson('/api/dj/spotify/auth/disconnect', { method: 'POST' });
  if (spotifyState.player) {
    try {
      await spotifyState.player.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }
  spotifyState.player = null;
  spotifyState.connected = false;
  spotifyState.deviceId = '';
  spotifyState.sdkReady = false;
  spotifyState.currentTrackUri = '';
  resetSpotifyTransportUi();
  setSpotifyAuthHint('Spotify account disconnected.');
  setSpotifyStatus('Spotify disconnected.');
  if (spotifyDisconnectBtn) spotifyDisconnectBtn.disabled = true;
}

async function playTrackInBrowser(trackId) {
  const spotifyTrackId = normalizeSpotifyTrackId(trackId);
  if (!spotifyTrackId) throw new Error('Resolved Spotify track ID is invalid.');
  if (!spotifyState.connected) throw new Error('Spotify is not connected. Click "Connect Spotify" first.');

  await ensureSpotifyWebPlayer();
  if (!spotifyState.deviceId) throw new Error('Spotify browser player is not ready yet. Retry in a moment.');

  const trackUri = `spotify:track:${spotifyTrackId}`;
  await spotifyAdminFetchJson('/api/dj/spotify/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackUri, deviceId: spotifyState.deviceId })
  });

  spotifyState.currentTrackId = spotifyTrackId;
  spotifyState.currentTrackUri = trackUri;
  spotifyState.isPaused = false;
  updateSpotifyTransportUi();
}

async function toggleSpotifyPlayPause() {
  if (!spotifyState.player || !spotifyState.currentTrackUri) {
    throw new Error('Start queue playback first.');
  }
  await spotifyState.player.togglePlay();
}

async function restartSpotifyTrack() {
  if (!spotifyState.player || !spotifyState.currentTrackUri) return;
  await spotifyState.player.seek(0);
  spotifyState.positionMs = 0;
  updateSpotifyTransportUi();
}

async function seekSpotifyTrack(msValue) {
  if (!spotifyState.player || !spotifyState.currentTrackUri) return;
  await spotifyState.player.seek(Math.max(0, Number(msValue) || 0));
}

>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
async function resolveSpotifyForQueueItem(item) {
  const fromUrl = normalizeSpotifyTrackId(item?.spotifyUrl || '');
  const fromTrackId = normalizeSpotifyTrackId(item?.trackId || '');
  const directTrackId = fromUrl || fromTrackId;

  const params = new URLSearchParams();
  const searchQuery = [String(item?.trackName || '').trim(), String((item?.artists || [])[0] || '').trim()].filter(Boolean).join(' ');

  if (!searchQuery) {
    if (!directTrackId) return { trackId: '', spotifyUrl: '', resolvedFrom: 'none', durationMs: 0 };
    return {
      trackId: directTrackId,
      spotifyUrl: item?.spotifyUrl || `https://open.spotify.com/track/${directTrackId}`,
      resolvedFrom: 'queue',
      durationMs: 0
    };
  }

  params.set('q', searchQuery);
  params.set('type', 'track');
  params.set('limit', '8');
  params.set('offset', '0');

  const response = await fetch(window.appApi.buildApiUrl(`/api/public/spotify/search?${params.toString()}`));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to resolve Spotify match for this queue song.');
  }

  const candidates = Array.isArray(payload.items) ? payload.items.filter((entry) => entry.kind === 'track') : [];
  if (!candidates.length && !directTrackId) {
    return { trackId: '', spotifyUrl: '', resolvedFrom: 'none', durationMs: 0 };
  }

  if (directTrackId) {
    const exact = candidates.find((candidate) => normalizeSpotifyTrackId(candidate.id) === directTrackId);
    return {
      trackId: directTrackId,
      spotifyUrl: exact?.spotifyUrl || item?.spotifyUrl || `https://open.spotify.com/track/${directTrackId}`,
      resolvedFrom: exact ? 'queue_exact' : 'queue',
      durationMs: Math.max(0, Number(exact?.durationMs) || 0)
    };
  }

  const best = candidates
    .map((candidate) => ({ candidate, score: scoreSpotifyCandidate(item, candidate) }))
    .sort((left, right) => right.score - left.score)[0];

  const resolvedTrackId = normalizeSpotifyTrackId(best?.candidate?.spotifyUrl || best?.candidate?.id || '');
  if (!resolvedTrackId) return { trackId: '', spotifyUrl: '', resolvedFrom: 'none', durationMs: 0 };

  return {
    trackId: resolvedTrackId,
    spotifyUrl: String(best.candidate.spotifyUrl || `https://open.spotify.com/track/${resolvedTrackId}`),
    resolvedFrom: 'spotify_search',
    durationMs: Math.max(0, Number(best.candidate.durationMs) || 0)
  };
}

async function loadSpotifyForQueueItem(item) {
  if (!item) {
    setSpotifyStatus('No approved songs in queue.', true);
    return;
  }

  const resolved = await resolveSpotifyForQueueItem(item);
  const trackId = resolved.trackId;
  if (!trackId) {
    setSpotifyStatus('Could not find a reliable Spotify match for this queue song. Move it to flagged and add a specific match.', true);
    return;
  }

  await playTrackInBrowser(trackId);
  spotifyState.currentQueueItemId = item.id;
  spotifyState.currentTrackId = trackId;

  renderEmbeddedTrackMeta(item, resolved.spotifyUrl || `https://open.spotify.com/track/${trackId}`);

<<<<<<< HEAD
  if (playerArtwork) {
    const imageUrl = safeImageUrl(item.albumImage);
    playerArtwork.src = imageUrl;
    playerArtwork.alt = item.trackName ? `Artwork for ${item.trackName}` : 'Current track artwork';
  }

  const modeLabel = resolved.resolvedFrom === 'spotify_search' ? 'Resolved with Spotify search.' : 'Loaded from queue metadata.';
  setSpotifyStatus(`Loaded "${item.trackName}" by ${formatArtists(item.artists)}. ${modeLabel}`);

  scheduleAutoAdvance(resolved.durationMs);
  await persistNowPlayingFromTrack(item, resolved.spotifyUrl);
=======
  const modeLabel = resolved.resolvedFrom === 'spotify_search' ? 'Resolved via Spotify search.' : 'Loaded from queue metadata.';
  setSpotifyStatus(`Playing "${item.trackName}" by ${formatArtists(item.artists)} using Spotify playback API. ${modeLabel}`);
  await persistNowPlayingFromTrack(item, {
    trackId,
    spotifyUrl: resolved.spotifyUrl || `https://open.spotify.com/track/${trackId}`,
    source: 'spotify_playback_sdk'
  });
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
}

async function startSpotifyQueuePlayback() {
  if (!spotifyState.connected) {
    await loadSpotifyAuthStatus();
  }
  const head = getQueueHead();
  if (!head) {
    setSpotifyStatus('No approved songs in queue.', true);
    return;
  }
  await loadSpotifyForQueueItem(head);
}

async function advanceSpotifyQueue() {
  setControlStatus('Advancing queue...');
  try {
    const payload = await callControlAction('play_next_approved');
    if (!payload) return;

    await loadQueue({ silent: true });
    await loadPlaybackSnapshot({ silent: true });

    const head = getQueueHead();
    if (!head) {
      if (spotifyOpenLink) spotifyOpenLink.href = '#';
      spotifyState.currentQueueItemId = null;
      spotifyState.currentTrackId = '';
<<<<<<< HEAD
      clearPlaybackTimers();
      updateCountdownLabel('Auto-advance: waiting for queue');
=======
      spotifyState.currentTrackUri = '';
      if (spotifyTrackName) spotifyTrackName.textContent = 'Queue finished';
      if (spotifyArtistName) spotifyArtistName.textContent = 'Add or approve more songs to continue.';
      setSpotifyArtwork(null);
      resetSpotifyTransportUi();
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
      setSpotifyStatus('Queue finished.');
      setControlStatus('Played next queue song (queue now empty).');
      return;
    }

    await loadSpotifyForQueueItem(head);
    setControlStatus('Played next queue song.');
  } catch (error) {
    setControlStatus(error.message || 'Unable to advance queue.', true);
  }
}

function toggleAutoAdvance() {
  spotifyState.autoAdvanceEnabled = !spotifyState.autoAdvanceEnabled;
  updateAutoButtonState();

  if (!spotifyState.autoAdvanceEnabled) {
    clearPlaybackTimers();
    updateCountdownLabel('Auto-advance: off');
    setSpotifyStatus('Auto-advance disabled.');
    return;
  }

  scheduleAutoAdvance(spotifyState.activeDurationMs);
  setSpotifyStatus('Auto-advance enabled.');
}

async function runControl(action, successMessage) {
  setControlStatus('Applying control...');
  try {
    const payload = await callControlAction(action);
    if (!payload) return;
    await loadQueue({ silent: true });
    await loadPlaybackSnapshot({ silent: true });
    setControlStatus(successMessage);
  } catch (error) {
    setControlStatus(error.message || 'Unable to run control action.', true);
  }
}

function wireEvents() {
  refreshAdminBtn?.addEventListener('click', async () => {
    try {
      await loadQueue();
    } catch (error) {
      setStatus(error.message || 'Unable to load queue.', true);
    }
  });

<<<<<<< HEAD
  playNextBtn?.addEventListener('click', advanceSpotifyQueue);
  spotifyStartBtn?.addEventListener('click', startSpotifyQueuePlayback);
  spotifyNextBtn?.addEventListener('click', advanceSpotifyQueue);
  spotifyAutoBtn?.addEventListener('click', toggleAutoAdvance);
=======
  playNextBtn?.addEventListener('click', runPlayNextControl);
  clearApprovedBtn?.addEventListener('click', () => runControl('clear_approved', 'Queue cleared.'));
  clearFlaggedBtn?.addEventListener('click', () => runControl('clear_pending', 'Review lane cleared.'));
  clearExplicitBtn?.addEventListener('click', () => runControl('clear_denied', 'Blocked lane cleared.'));
  renumberBtn?.addEventListener('click', () => runControl('renumber_active', 'Queue order fixed.'));
  clearAllBtn?.addEventListener('click', () => runControl('clear_all', 'Entire queue cleared.'));

  spotifyStartBtn?.addEventListener('click', async () => {
    try {
      await startSpotifyQueuePlayback();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to start Spotify playback.', true);
    }
  });
  spotifyNextBtn?.addEventListener('click', runPlayNextControl);
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
  refreshPlaybackBtn?.addEventListener('click', () => loadPlaybackSnapshot());

  spotifyPlayPauseBtn?.addEventListener('click', async () => {
    try {
      await toggleSpotifyPlayPause();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to toggle playback.', true);
    }
  });

  spotifyRestartBtn?.addEventListener('click', async () => {
    try {
      await restartSpotifyTrack();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to restart current track.', true);
    }
  });

  spotifyConnectBtn?.addEventListener('click', async () => {
    try {
      await startSpotifyConnect();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to start Spotify authorization.', true);
    }
  });

  spotifyDisconnectBtn?.addEventListener('click', async () => {
    try {
      await disconnectSpotify();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to disconnect Spotify.', true);
    }
  });

  spotifySeekRange?.addEventListener('input', () => {
    spotifyState.isSeeking = true;
    const nextValue = Number(spotifySeekRange.value);
    if (!Number.isFinite(nextValue)) return;
    if (spotifyCurrentTime) spotifyCurrentTime.textContent = formatClock(nextValue);
  });

  spotifySeekRange?.addEventListener('change', async () => {
    spotifyState.isSeeking = false;
    const nextValue = Number(spotifySeekRange.value);
    if (!Number.isFinite(nextValue)) return;
    try {
      await seekSpotifyTrack(nextValue);
      spotifyState.positionMs = nextValue;
      updateSpotifyTransportUi();
    } catch (error) {
      setSpotifyStatus(error.message || 'Unable to seek in current track.', true);
    }
  });

  djQuickAddSearchBtn?.addEventListener('click', searchQuickAddSongs);
  djQuickAddInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    searchQuickAddSongs();
  });

  adminLogoutBtn?.addEventListener('click', () => {
    window.djAuth.clearAdminToken();
    window.location.href = '/dj/login.html';
  });

  enableListDrop(approvedQueueList, 'approved');
  enableListDrop(flaggedQueueList, 'pending');
  enableListDrop(explicitQueueList, 'rejected');
}

(async () => {
  const ok = await ensureAdminSession();
  if (!ok) return;

  wireEvents();
<<<<<<< HEAD
  updateAutoButtonState();
  updateCountdownLabel('Auto-advance: off');
=======
  updateSpotifyTransportUi();
  if (spotifyOpenLink) spotifyOpenLink.href = '#';
  if (spotifyDisconnectBtn) spotifyDisconnectBtn.disabled = true;
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)

  try {
    const authMessage = parseSpotifyAuthMessageFromUrl();
    await loadSpotifyAuthStatus();
    if (authMessage?.auth === 'connected') {
      setSpotifyStatus('Spotify account connected. Start queue playback to use the browser player.');
    } else if (authMessage?.auth === 'error') {
      setSpotifyStatus(`Spotify authorization failed: ${authMessage.reason || 'unknown_error'}.`, true);
    }

    await loadQueue();
    await loadPlaybackSnapshot();
<<<<<<< HEAD
    setSpotifyStatus('Ready. Use start to load the top queue song.');
=======
    if (spotifyState.connected) {
      setSpotifyStatus('Ready. Start queue playback to play in this page.');
      loadSpotifySdkScript().catch(() => {
        // defer script load errors until playback starts
      });
    } else if (!authMessage) {
      setSpotifyStatus('Connect Spotify to start playback.', true);
    }
>>>>>>> f0d4a8e (feat: integrate Spotify OAuth flow and update SoundCloud references)
  } catch (error) {
    setStatus(error.message || 'Initialization failed.', true);
  }

  setInterval(async () => {
    try {
      await loadQueue({ silent: true });
    } catch {
      // silent refresh
    }
  }, 9000);

  setInterval(() => {
    loadPlaybackSnapshot({ silent: true });
  }, 14000);
})();
