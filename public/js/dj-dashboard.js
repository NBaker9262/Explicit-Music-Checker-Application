const adminStatusMessage = document.getElementById('adminStatusMessage');
const adminControlStatus = document.getElementById('adminControlStatus');
const approvedQueueList = document.getElementById('approvedQueueList');
const flaggedQueueList = document.getElementById('flaggedQueueList');
const explicitQueueList = document.getElementById('explicitQueueList');
const requesterMetricsStatus = document.getElementById('requesterMetricsStatus');
const requesterMetricsBody = document.getElementById('requesterMetricsBody');

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
const playbackHistoryList = document.getElementById('playbackHistoryList');
const djQuickAddStatus = document.getElementById('djQuickAddStatus');
const djQuickAddInput = document.getElementById('djQuickAddInput');
const djQuickAddSearchBtn = document.getElementById('djQuickAddSearchBtn');
const djQuickAddResults = document.getElementById('djQuickAddResults');

const soundCloudStatus = document.getElementById('soundCloudStatus');
const soundCloudStartBtn = document.getElementById('soundCloudStartBtn');
const soundCloudPlayPauseBtn = document.getElementById('soundCloudPlayPauseBtn');
const soundCloudRestartBtn = document.getElementById('soundCloudRestartBtn');
const soundCloudNextBtn = document.getElementById('soundCloudNextBtn');
const soundCloudAutoNext = document.getElementById('soundCloudAutoNext');
const soundCloudArtwork = document.getElementById('soundCloudArtwork');
const soundCloudTrackTitle = document.getElementById('soundCloudTrackTitle');
const soundCloudTrackMeta = document.getElementById('soundCloudTrackMeta');
const soundCloudQueueMeta = document.getElementById('soundCloudQueueMeta');
const soundCloudCurrentTime = document.getElementById('soundCloudCurrentTime');
const soundCloudDuration = document.getElementById('soundCloudDuration');
const soundCloudProgress = document.getElementById('soundCloudProgress');
const soundCloudVolume = document.getElementById('soundCloudVolume');
const soundCloudOpenLink = document.getElementById('soundCloudOpenLink');
const soundCloudManualUrl = document.getElementById('soundCloudManualUrl');
const soundCloudLoadUrlBtn = document.getElementById('soundCloudLoadUrlBtn');
const soundCloudPlayerFrame = document.getElementById('soundCloudPlayerFrame');

let dragItemId = null;
let dragSourceStatus = '';
let approvedQueueItems = [];
let allQueueItems = [];
let djSession = { username: 'DJ' };

const soundCloudState = {
  widget: null,
  currentQueueItemId: null,
  currentMatch: null,
  isAdvancing: false,
  loadToken: 0,
  isReady: false,
  isPlaying: false,
  durationMs: 0,
  positionMs: 0,
  isSeeking: false,
  volume: 80
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
  adminStatusMessage.textContent = message;
  adminStatusMessage.className = `status-message${isError ? ' error' : ''}`;
}

function setControlStatus(message, isError = false) {
  adminControlStatus.textContent = message;
  adminControlStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setRequesterMetricsStatus(message, isError = false) {
  requesterMetricsStatus.textContent = message;
  requesterMetricsStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setSoundCloudStatus(message, isError = false) {
  soundCloudStatus.textContent = message;
  soundCloudStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setQuickAddStatus(message, isError = false) {
  if (!djQuickAddStatus) return;
  djQuickAddStatus.textContent = message;
  djQuickAddStatus.className = `status-message${isError ? ' error' : ''}`;
}

function setPlaybackStatus(message, isError = false) {
  if (!playbackStatus) return;
  playbackStatus.textContent = message;
  playbackStatus.className = `status-message${isError ? ' error' : ''}`;
}

function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

function renderPlaybackSnapshot(snapshot) {
  const nowPlaying = snapshot?.nowPlaying || null;
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];

  if (nowPlaying && nowPlaying.trackName) {
    if (nowPlayingTitle) nowPlayingTitle.textContent = nowPlaying.trackName;
    if (nowPlayingMeta) nowPlayingMeta.textContent = (nowPlaying.artists || []).join(', ') || '-';
    if (nowPlayingBy) nowPlayingBy.textContent = `Played by: ${nowPlaying.playedBy || '-'} at ${formatDateTime(nowPlaying.playedAt)}`;
  } else {
    if (nowPlayingTitle) nowPlayingTitle.textContent = 'No track active';
    if (nowPlayingMeta) nowPlayingMeta.textContent = 'Start playback from queue to persist now-playing state.';
    if (nowPlayingBy) nowPlayingBy.textContent = 'Played by: -';
  }

  if (!playbackHistoryList) return;
  playbackHistoryList.innerHTML = '';
  if (!history.length) {
    playbackHistoryList.innerHTML = '<p class="empty-state">No playback history yet.</p>';
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement('article');
    row.className = 'queue-card';
    row.innerHTML = `
      <div class="queue-main">
        <img src="${escapeHtml(safeImageUrl(entry.albumImage))}" alt="Album art for ${escapeHtml(entry.trackName)}">
        <div>
          <h3>${escapeHtml(entry.trackName)}</h3>
          <p>${escapeHtml((entry.artists || []).join(', ') || '-')}</p>
          <p>Played by ${escapeHtml(entry.playedBy || '-')} at ${escapeHtml(formatDateTime(entry.playedAt))}</p>
        </div>
      </div>
    `;
    playbackHistoryList.appendChild(row);
  });
}

async function loadPlaybackSnapshot({ silent = false } = {}) {
  if (!silent) setPlaybackStatus('Loading playback state...');
  try {
    const response = await window.djAuth.adminFetch('/api/dj/playback?limit=20');
    const payload = await response.json();
    if (response.status === 401) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return;
    }
    if (!response.ok) throw new Error(payload.error || 'Unable to load playback state');
    renderPlaybackSnapshot(payload);
    if (!silent) setPlaybackStatus('Playback state loaded.');
  } catch (error) {
    if (!silent) setPlaybackStatus(error.message || 'Unable to load playback state.', true);
  }
}

async function persistNowPlayingFromTrack(track, { source = 'dj_manual' } = {}) {
  if (!track || !track.trackName || !Array.isArray(track.artists) || !track.artists.length) return;
  try {
    await window.djAuth.adminFetch('/api/dj/playback/now-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: track.trackId || track.id || '',
        trackName: track.trackName || track.name || '',
        artists: track.artists || [],
        albumImage: track.albumImage || '',
        spotifyUrl: track.spotifyUrl || '',
        playedBy: djSession.username || 'DJ',
        source
      })
    });
    await loadPlaybackSnapshot({ silent: true });
  } catch {
    // no-op for best-effort UI sync
  }
}

function getQueueHead() {
  return approvedQueueItems.length ? approvedQueueItems[0] : null;
}

function getCurrentQueueItem() {
  if (soundCloudState.currentQueueItemId === null) return null;
  return approvedQueueItems.find((item) => item.id === soundCloudState.currentQueueItemId) || null;
}

function updatePlayPauseButton() {
  if (!soundCloudPlayPauseBtn) return;

  const hasLoadedTrack = Boolean(soundCloudState.widget && soundCloudState.isReady);
  soundCloudPlayPauseBtn.disabled = !hasLoadedTrack && !getQueueHead();

  if (!hasLoadedTrack) {
    soundCloudPlayPauseBtn.textContent = 'Play';
    return;
  }

  soundCloudPlayPauseBtn.textContent = soundCloudState.isPlaying ? 'Pause' : 'Play';
}

function updateProgressUi() {
  const durationMs = Math.max(0, Number(soundCloudState.durationMs) || 0);
  const positionMs = Math.max(0, Number(soundCloudState.positionMs) || 0);
  const boundedPosition = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;

  if (soundCloudCurrentTime) soundCloudCurrentTime.textContent = formatDurationMs(boundedPosition);
  if (soundCloudDuration) soundCloudDuration.textContent = formatDurationMs(durationMs);

  if (soundCloudProgress && !soundCloudState.isSeeking) {
    const ratio = durationMs > 0 ? (boundedPosition / durationMs) : 0;
    soundCloudProgress.value = String(Math.round(ratio * 1000));
  }

  if (soundCloudProgress) {
    const canSeek = Boolean(soundCloudState.widget && soundCloudState.isReady && durationMs > 0);
    soundCloudProgress.disabled = !canSeek;
  }
}

function updateVolumeUi() {
  if (!soundCloudVolume) return;
  soundCloudVolume.value = String(Math.max(0, Math.min(100, Math.round(Number(soundCloudState.volume) || 0))));
}

function resetSoundCloudPlayerUi() {
  soundCloudState.widget = null;
  soundCloudState.currentQueueItemId = null;
  soundCloudState.currentMatch = null;
  soundCloudState.isReady = false;
  soundCloudState.isPlaying = false;
  soundCloudState.durationMs = 0;
  soundCloudState.positionMs = 0;
  soundCloudState.isSeeking = false;

  if (soundCloudTrackTitle) soundCloudTrackTitle.textContent = 'No track loaded';
  if (soundCloudTrackMeta) soundCloudTrackMeta.textContent = 'Start queue playback to load a song.';
  if (soundCloudQueueMeta) soundCloudQueueMeta.textContent = 'Queue slot: -';
  if (soundCloudOpenLink) {
    soundCloudOpenLink.href = '#';
    soundCloudOpenLink.setAttribute('aria-disabled', 'true');
  }
  if (soundCloudArtwork) {
    soundCloudArtwork.src = '';
    soundCloudArtwork.alt = 'No artwork';
  }

  updatePlayPauseButton();
  updateProgressUi();
}

function renderSoundCloudTrackUi(queueItem, match) {
  if (!queueItem || !match) {
    resetSoundCloudPlayerUi();
    return;
  }

  const setOrder = Number.isInteger(queueItem?.setOrder) ? `#${queueItem.setOrder}` : '-';
  const artists = (queueItem?.artists || []).join(', ') || '-';
  const matchArtist = String(match.artist || '').trim() || 'Unknown artist';

  if (soundCloudTrackTitle) soundCloudTrackTitle.textContent = queueItem.trackName || match.title || 'Unknown title';
  if (soundCloudTrackMeta) soundCloudTrackMeta.textContent = `${artists} | SoundCloud: ${matchArtist}`;
  if (soundCloudQueueMeta) soundCloudQueueMeta.textContent = `Queue slot: ${setOrder}`;

  const artUrl = safeImageUrl(match.artworkUrl) || safeImageUrl(queueItem.albumImage);
  if (soundCloudArtwork) {
    soundCloudArtwork.src = artUrl;
    soundCloudArtwork.alt = artUrl ? `Artwork for ${queueItem.trackName || 'track'}` : 'No artwork';
  }

  if (soundCloudOpenLink) {
    const permalink = safeImageUrl(match.permalinkUrl);
    soundCloudOpenLink.href = permalink || '#';
    soundCloudOpenLink.setAttribute('aria-disabled', permalink ? 'false' : 'true');
  }

  soundCloudState.durationMs = Math.max(0, Number(match.durationMs) || 0);
  soundCloudState.positionMs = 0;
  updateProgressUi();
  updatePlayPauseButton();
}

function buildWidgetSrcFromUrl(trackUrl) {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: 'true',
    hide_related: 'true',
    show_comments: 'false',
    show_user: 'true',
    show_reposts: 'false',
    visual: 'false'
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

function normalizeManualSoundCloudUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    const host = String(parsed.hostname || '').toLowerCase();
    if (!(protocol === 'http:' || protocol === 'https:')) return '';
    if (!(host.endsWith('soundcloud.com') || host.endsWith('on.soundcloud.com'))) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

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

function splitQueue(items) {
  return {
    queue: items.filter((item) => item.status === 'approved'),
    flagged: items.filter((item) => item.status === 'pending'),
    explicit: items.filter((item) => item.status === 'rejected')
  };
}

function getQueueItemById(itemId) {
  return allQueueItems.find((item) => item.id === itemId) || null;
}

function statusLabel(status) {
  if (status === 'approved') return 'queue';
  if (status === 'pending') return 'flagged';
  if (status === 'rejected') return 'explicit';
  return status || 'unknown';
}

function createStatusBadge(item) {
  return `<span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>`;
}

function createSongMeta(item) {
  const artists = escapeHtml((item.artists || []).join(', '));
  const orderLabel = Number.isInteger(item.setOrder) ? `#${item.setOrder}` : '';
  const orderLine = item.status === 'rejected' ? '' : `<p>Line: <strong>${escapeHtml(orderLabel || '-')}</strong></p>`;
  return `
    <p>${artists}</p>
    ${orderLine}
  `;
}

function getActionButtons(item) {
  if (item.status === 'approved') {
    return `
      <button class="btn btn-primary" type="button" data-action="pin">Pin Next</button>
      <button class="btn" type="button" data-action="flagged">Flag</button>
      <button class="btn btn-danger" type="button" data-action="deny">Mark Explicit</button>
    `;
  }

  if (item.status === 'pending') {
    return `
      <button class="btn btn-primary" type="button" data-action="pin">Pin Next</button>
      <button class="btn btn-primary" type="button" data-action="approve">Move To Queue</button>
      <button class="btn btn-danger" type="button" data-action="deny">Mark Explicit</button>
    `;
  }

  return `
    <button class="btn btn-primary" type="button" data-action="approve">Move To Queue</button>
  `;
}

function animateDroppedRow(itemId) {
  const row = document.querySelector(`.queue-row[data-item-id="${itemId}"]`);
  if (!row) return;
  row.classList.remove('drop-bounce');
  // Reflow to restart the animation class when dragging repeatedly.
  void row.offsetWidth;
  row.classList.add('drop-bounce');
  setTimeout(() => row.classList.remove('drop-bounce'), 350);
}

async function moveDraggedItem(targetStatus, beforeId = null) {
  if (dragItemId === null) return;
  const sourceItem = getQueueItemById(dragItemId);
  if (!sourceItem) return;
  const nextStatus = String(targetStatus || '').trim();
  if (!nextStatus || !['approved', 'pending', 'rejected'].includes(nextStatus)) return;

  if (sourceItem.status === nextStatus) {
    if (nextStatus !== 'rejected') {
      await reorderQueue(dragItemId, beforeId, { reload: true });
      animateDroppedRow(dragItemId);
    }
    return;
  }

  const reason = nextStatus === 'rejected' ? 'explicit_lyrics' : '';
  await updateStatus(dragItemId, nextStatus, reason, { reload: false });
  if (nextStatus !== 'rejected' && beforeId !== null) {
    await reorderQueue(dragItemId, beforeId, { reload: false });
  }
  await loadQueue({ silent: true });
  animateDroppedRow(dragItemId);
}

async function pinTrack(itemId) {
  setStatus('Pinning track to top...');
  try {
    const payload = await callControlAction('pin_track', { itemId });
    if (!payload) return;
    setStatus('Track pinned to top.');
    await loadQueue({ silent: true });
  } catch (error) {
    setStatus(error.message || 'Unable to pin track.', true);
  }
}

function attachRowEvents(row, item) {
  const approveBtn = row.querySelector('[data-action="approve"]');
  const flaggedBtn = row.querySelector('[data-action="flagged"]');
  const denyBtn = row.querySelector('[data-action="deny"]');
  const pinBtn = row.querySelector('[data-action="pin"]');

  if (approveBtn) {
    approveBtn.addEventListener('click', () => {
      updateStatus(item.id, 'approved', '').catch(() => {});
    });
  }
  if (flaggedBtn) {
    flaggedBtn.addEventListener('click', () => {
      updateStatus(item.id, 'pending', '').catch(() => {});
    });
  }
  if (denyBtn) {
    denyBtn.addEventListener('click', () => {
      updateStatus(item.id, 'rejected', 'explicit_lyrics').catch(() => {});
    });
  }
  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      pinTrack(item.id).catch(() => {});
    });
  }

  row.draggable = true;
  row.classList.add('draggable-row');

  row.addEventListener('dragstart', (event) => {
    dragItemId = item.id;
    dragSourceStatus = item.status;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(item.id));
    document.body.classList.add('drag-active');
  });

  row.addEventListener('dragend', () => {
    dragItemId = null;
    dragSourceStatus = '';
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
    } catch {
      // no-op; status UI already set by lower-level handlers
    }
  });
}

function createQueueRow(item) {
  const row = document.createElement('article');
  row.className = `queue-row queue-row-${item.status}`;
  row.dataset.itemId = String(item.id);

  const pendingNote = item.status === 'pending'
    ? '<p class="pending-note">Flagged items keep line position and are skipped.</p>'
    : '';

  const deniedReason = item.status === 'rejected' && item.moderationReason
    ? `<p class="pending-note">Reason: ${escapeHtml(item.moderationReason)}</p>`
    : '';

  const dragLabel = '<span class="drag-label">Drag</span>';

  row.innerHTML = `
    <div class="queue-row-main">
      <img src="${escapeHtml(safeImageUrl(item.albumImage))}" alt="Album art for ${escapeHtml(item.trackName)}">
      <div>
        <h4>${escapeHtml(item.trackName)}</h4>
        <p>${createStatusBadge(item)}</p>
        ${createSongMeta(item)}
        ${pendingNote}
        ${deniedReason}
      </div>
    </div>
    <div class="queue-row-controls">
      ${dragLabel}
      ${getActionButtons(item)}
    </div>
  `;

  attachRowEvents(row, item);
  return row;
}

function formatRequesterMetricDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

function renderRequesterMetrics(rows) {
  requesterMetricsBody.innerHTML = '';
  if (!rows.length) {
    requesterMetricsBody.innerHTML = '<tr><td colspan="6" class="metrics-empty">No requester metrics yet.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.name || '-')}</td>
      <td>${escapeHtml(String(Number(row.requestCount) || 0))}</td>
      <td>${escapeHtml(String(Number(row.approvedCount) || 0))}</td>
      <td>${escapeHtml(String(Number(row.pendingCount) || 0))}</td>
      <td>${escapeHtml(String(Number(row.rejectedCount) || 0))}</td>
      <td>${escapeHtml(formatRequesterMetricDate(row.lastRequestedAt))}</td>
    `;
    requesterMetricsBody.appendChild(tr);
  });
}

async function loadRequesterMetrics() {
  setRequesterMetricsStatus('Loading requester metrics...');

  try {
    const response = await window.djAuth.adminFetch('/api/dj/analytics');
    const payload = await response.json();

    if (response.status === 401) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load requester metrics');
    }

    const rows = Array.isArray(payload.topRequesters) ? payload.topRequesters : [];
    renderRequesterMetrics(rows);
    setRequesterMetricsStatus(rows.length ? `Loaded ${rows.length} requester metric row(s).` : 'No requester metrics yet.');
  } catch (error) {
    renderRequesterMetrics([]);
    setRequesterMetricsStatus(error.message || 'Unable to load requester metrics.', true);
  }
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
    const imageUrl = safeImageUrl(item.albumImage);
    const artists = (item.artists || []).join(', ');

    card.innerHTML = `
      <img class="quick-add-cover" src="${escapeHtml(imageUrl)}" alt="Cover art for ${escapeHtml(item.name)}">
      <div class="song-card-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(artists)}</p>
        <button class="btn btn-primary" type="button">Add To Queue</button>
      </div>
    `;

    const addBtn = card.querySelector('button');
    addBtn?.addEventListener('click', async () => {
      await addQuickSongToQueue(item);
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

  setQuickAddStatus('Searching...');
  if (djQuickAddSearchBtn) djQuickAddSearchBtn.disabled = true;

  try {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('type', 'track');
    params.set('limit', '12');
    params.set('offset', '0');
    const response = await fetch(window.appApi.buildApiUrl(`/api/public/spotify/search?${params.toString()}`));
    const payload = await response.json();
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

async function addQuickSongToQueue(track) {
  if (!track?.id || !track?.name || !Array.isArray(track.artists) || !track.artists.length) {
    setQuickAddStatus('Selected song is missing required fields.', true);
    return;
  }

  setQuickAddStatus(`Adding "${track.name}"...`);

  try {
    const payload = {
      trackId: String(track.id || ''),
      trackName: String(track.name || ''),
      artists: track.artists || [],
      albumName: String(track.albumName || ''),
      albumImage: String(track.albumImage || ''),
      spotifyUrl: String(track.spotifyUrl || ''),
      explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
      requesterName: djSession.username || 'DJ',
      requesterRole: 'admin'
    };

    const response = await window.djAuth.adminFetch('/api/public/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (response.status === 409 && result.code === 'duplicate_active') {
      throw new Error('This song is already in queue/review.');
    }
    if (!response.ok) throw new Error(result.error || 'Unable to add song');

    setQuickAddStatus(`Added "${result.trackName}" as ${result.status}.`);
    await loadQueue({ silent: true });
  } catch (error) {
    setQuickAddStatus(error.message || 'Unable to add song.', true);
  }
}

function renderSection(listEl, items, emptyMessage) {
  listEl.innerHTML = '';
  listEl.dataset.sectionStatus = items?.[0]?.status || listEl.dataset.sectionStatus || '';
  if (!items.length) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  items.forEach((item) => {
    listEl.appendChild(createQueueRow(item));
  });
}

function enableListDrop(listEl, targetStatus) {
  if (!listEl) return;
  listEl.dataset.sectionStatus = targetStatus;

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
    } catch {
      // no-op; status UI already set by lower-level handlers
    }
  });
}

function syncSoundCloudQueue(items) {
  approvedQueueItems = Array.isArray(items) ? [...items] : [];

  if (soundCloudState.currentQueueItemId !== null) {
    const stillExists = approvedQueueItems.some((item) => item.id === soundCloudState.currentQueueItemId);
    if (!stillExists) {
      resetSoundCloudPlayerUi();
      if (!soundCloudState.isAdvancing) {
        setSoundCloudStatus('Current song is no longer in queue.');
      }
    }
  }

  updatePlayPauseButton();
}

function buildSoundCloudResolvePath(queueItem) {
  const params = new URLSearchParams();
  params.set('trackName', queueItem.trackName || '');
  (queueItem.artists || []).forEach((artist) => params.append('artist', String(artist || '')));
  return `/api/dj/soundcloud/resolve?${params.toString()}`;
}

async function waitForSoundCloudWidgetApi(timeoutMs = 10000) {
  if (window.SC?.Widget) return true;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (window.SC?.Widget) return true;
  }

  return false;
}

function bindSoundCloudWidgetEvents(widget, queueItem, loadToken) {
  widget.bind(window.SC.Widget.Events.READY, () => {
    if (soundCloudState.loadToken !== loadToken) return;

    soundCloudState.isReady = true;
    soundCloudState.isPlaying = false;

    widget.getDuration((durationMs) => {
      if (soundCloudState.loadToken !== loadToken) return;
      soundCloudState.durationMs = Math.max(soundCloudState.durationMs, Number(durationMs) || 0);
      updateProgressUi();
    });

    widget.getPosition((positionMs) => {
      if (soundCloudState.loadToken !== loadToken) return;
      soundCloudState.positionMs = Math.max(0, Number(positionMs) || 0);
      updateProgressUi();
    });

    widget.getVolume((volume) => {
      if (soundCloudState.loadToken !== loadToken) return;
      soundCloudState.volume = Math.max(0, Math.min(100, Number(volume) || 0));
      updateVolumeUi();
    });

    setSoundCloudStatus(`Ready to play "${queueItem.trackName}".`);
    updatePlayPauseButton();
  });

  widget.bind(window.SC.Widget.Events.PLAY, () => {
    if (soundCloudState.loadToken !== loadToken) return;
    soundCloudState.isPlaying = true;
    setSoundCloudStatus(`Playing "${queueItem.trackName}".`);
    updatePlayPauseButton();
  });

  widget.bind(window.SC.Widget.Events.PAUSE, () => {
    if (soundCloudState.loadToken !== loadToken) return;
    soundCloudState.isPlaying = false;
    setSoundCloudStatus(`Paused "${queueItem.trackName}".`);
    updatePlayPauseButton();
  });

  widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (event) => {
    if (soundCloudState.loadToken !== loadToken) return;
    if (soundCloudState.isSeeking) return;

    const currentPosition = Number(event?.currentPosition);
    if (Number.isFinite(currentPosition) && currentPosition >= 0) {
      soundCloudState.positionMs = currentPosition;
    } else {
      const relative = Number(event?.relativePosition);
      if (Number.isFinite(relative) && relative >= 0 && soundCloudState.durationMs > 0) {
        soundCloudState.positionMs = Math.round(relative * soundCloudState.durationMs);
      }
    }

    const duration = Number(event?.currentSound?.duration || event?.sound?.duration || 0);
    if (Number.isFinite(duration) && duration > 0) {
      soundCloudState.durationMs = Math.max(soundCloudState.durationMs, duration);
    }

    updateProgressUi();
  });

  widget.bind(window.SC.Widget.Events.FINISH, async () => {
    if (soundCloudState.loadToken !== loadToken) return;

    soundCloudState.isPlaying = false;
    soundCloudState.positionMs = soundCloudState.durationMs;
    updateProgressUi();
    updatePlayPauseButton();

    if (!soundCloudAutoNext?.checked) {
      setSoundCloudStatus('Track finished. Auto-advance is off.');
      return;
    }

    if (soundCloudState.currentQueueItemId === null) {
      setSoundCloudStatus('Manual track finished.');
      return;
    }

    await advanceSoundCloudQueue();
  });
}

async function loadSoundCloudForQueueItem(queueItem, { autoPlay = true } = {}) {
  if (!queueItem) {
    setSoundCloudStatus('No approved songs in queue.', true);
    return;
  }

  setSoundCloudStatus(`Resolving SoundCloud match for "${queueItem.trackName}"...`);
  const loadToken = Date.now();
  soundCloudState.loadToken = loadToken;

  try {
    const response = await window.djAuth.adminFetch(buildSoundCloudResolvePath(queueItem));
    const payload = await response.json();

    if (response.status === 401) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return;
    }

    if (!response.ok) {
      const detail = String(payload?.detail || '').trim();
      const statusLabel = Number(payload?.status || response.status) || response.status;
      if (detail) {
        throw new Error(`${payload.error || 'Unable to resolve SoundCloud track'} [${statusLabel}] (${detail})`);
      }
      throw new Error(`${payload.error || 'Unable to resolve SoundCloud track'} [${statusLabel}]`);
    }

    const ready = await waitForSoundCloudWidgetApi();
    if (!ready) {
      throw new Error('SoundCloud widget API not loaded. Refresh and retry.');
    }

    soundCloudPlayerFrame.src = String(payload.widgetSrc || 'about:blank');

    soundCloudState.currentQueueItemId = queueItem.id;
    soundCloudState.currentMatch = payload.match || null;
    soundCloudState.isReady = false;
    soundCloudState.isPlaying = false;
    soundCloudState.durationMs = Math.max(0, Number(payload?.match?.durationMs) || 0);
    soundCloudState.positionMs = 0;

    renderSoundCloudTrackUi(queueItem, payload.match || null);
    await persistNowPlayingFromTrack({
      trackId: queueItem.trackId,
      trackName: queueItem.trackName,
      artists: queueItem.artists || [],
      albumImage: queueItem.albumImage || '',
      spotifyUrl: queueItem.spotifyUrl || ''
    }, { source: 'soundcloud_resolve' });

    const widget = window.SC.Widget(soundCloudPlayerFrame);
    soundCloudState.widget = widget;
    bindSoundCloudWidgetEvents(widget, queueItem, loadToken);

    if (autoPlay) {
      widget.play();
      setSoundCloudStatus(`Loading and starting "${queueItem.trackName}"...`);
    }
  } catch (error) {
    setSoundCloudStatus(error.message || 'Unable to load SoundCloud playback.', true);
  }
}

async function loadManualSoundCloudUrl() {
  const permalink = normalizeManualSoundCloudUrl(soundCloudManualUrl?.value || '');
  if (!permalink) {
    setSoundCloudStatus('Enter a valid SoundCloud track URL.', true);
    return;
  }

  const loadToken = Date.now();
  soundCloudState.loadToken = loadToken;

  const ready = await waitForSoundCloudWidgetApi();
  if (!ready) {
    setSoundCloudStatus('SoundCloud widget API not loaded. Refresh and retry.', true);
    return;
  }

  const queueItem = {
    id: null,
    trackName: 'Manual SoundCloud Track',
    artists: ['Manual URL'],
    setOrder: null,
    albumImage: ''
  };
  const match = {
    title: 'Manual SoundCloud Track',
    artist: 'Manual URL',
    durationMs: 0,
    artworkUrl: '',
    permalinkUrl: permalink
  };

  soundCloudPlayerFrame.src = buildWidgetSrcFromUrl(permalink);

  soundCloudState.currentQueueItemId = null;
  soundCloudState.currentMatch = match;
  soundCloudState.isReady = false;
  soundCloudState.isPlaying = false;
  soundCloudState.durationMs = 0;
  soundCloudState.positionMs = 0;

  renderSoundCloudTrackUi(queueItem, match);

  const widget = window.SC.Widget(soundCloudPlayerFrame);
  soundCloudState.widget = widget;
  bindSoundCloudWidgetEvents(widget, queueItem, loadToken);
  widget.play();
  setSoundCloudStatus('Loading manual SoundCloud URL...');
  await persistNowPlayingFromTrack({
    trackId: '',
    trackName: 'Manual SoundCloud Track',
    artists: ['Manual URL'],
    albumImage: '',
    spotifyUrl: permalink
  }, { source: 'soundcloud_manual' });
}

async function startSoundCloudQueuePlayback() {
  const head = getQueueHead();
  if (!head) {
    setSoundCloudStatus('No approved songs in queue to play.', true);
    return;
  }

  await loadSoundCloudForQueueItem(head, { autoPlay: true });
}

async function toggleSoundCloudPlayPause() {
  if (!soundCloudState.widget) {
    await startSoundCloudQueuePlayback();
    return;
  }

  if (soundCloudState.isPlaying) {
    soundCloudState.widget.pause();
  } else {
    soundCloudState.widget.play();
  }
}

async function restartSoundCloudTrack() {
  if (!soundCloudState.widget || !soundCloudState.isReady) {
    const current = getCurrentQueueItem() || getQueueHead();
    if (!current) {
      setSoundCloudStatus('No track available to restart.', true);
      return;
    }

    await loadSoundCloudForQueueItem(current, { autoPlay: true });
    return;
  }

  soundCloudState.widget.seekTo(0);
  soundCloudState.positionMs = 0;
  updateProgressUi();
  soundCloudState.widget.play();
}

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
  const payload = await response.json();

  if (response.status === 401) {
    window.djAuth.clearAdminToken();
    window.location.href = '/dj/login.html';
    return null;
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Control action failed');
  }

  return payload;
}

async function advanceSoundCloudQueue() {
  if (soundCloudState.isAdvancing) return;
  soundCloudState.isAdvancing = true;
  setSoundCloudStatus('Advancing to next queue song...');

  try {
    await callControlAction('play_next_approved');
    await loadPlaybackSnapshot({ silent: true });
    await loadQueue({ silent: true });

    const head = getQueueHead();
    if (!head) {
      soundCloudPlayerFrame.src = 'about:blank';
      resetSoundCloudPlayerUi();
      setSoundCloudStatus('Queue finished. No more approved songs.');
      return;
    }

    await loadSoundCloudForQueueItem(head, { autoPlay: true });
  } catch (error) {
    setSoundCloudStatus(error.message || 'Unable to advance playback.', true);
  } finally {
    soundCloudState.isAdvancing = false;
  }
}

async function loadQueue({ silent = false } = {}) {
  if (!silent) setStatus('Loading queue...');

  try {
    const response = await window.djAuth.adminFetch('/api/dj/queue');
    const payload = await response.json();

    if (response.status === 401) {
      window.djAuth.clearAdminToken();
      window.location.href = '/dj/login.html';
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load queue');
    }

    const items = payload.items || [];
    allQueueItems = items;
    const sections = splitQueue(items);
    approvedQueueList.dataset.sectionStatus = 'approved';
    flaggedQueueList.dataset.sectionStatus = 'pending';
    explicitQueueList.dataset.sectionStatus = 'rejected';
    renderSection(approvedQueueList, sections.queue, 'No songs in queue.');
    renderSection(flaggedQueueList, sections.flagged, 'No flagged songs.');
    renderSection(explicitQueueList, sections.explicit, 'No explicit songs.');
    syncSoundCloudQueue(sections.queue);

    if (!silent) {
      setStatus(`Queue loaded. ${items.length} total songs.`);
      await loadRequesterMetrics();
    }
  } catch (error) {
    setStatus(error.message || 'Unable to load queue.', true);
  }
}

async function updateStatus(itemId, status, moderationReason, { reload = true } = {}) {
  setStatus('Saving changes...');

  const payload = status === 'rejected'
    ? { status, moderationReason: moderationReason || 'other' }
    : { status, moderationReason: '' };

  try {
    const response = await window.djAuth.adminFetch(`/api/dj/queue/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Unable to update song');
    }

    setStatus(`Updated: ${result.trackName}`);
    if (reload) await loadQueue();
    else allQueueItems = allQueueItems.map((item) => (item.id === itemId ? result : item));
  } catch (error) {
    setStatus(error.message || 'Unable to update song.', true);
    throw error;
  }
}

async function reorderQueue(itemId, beforeId, { reload = true } = {}) {
  setStatus('Updating order...');

  try {
    const response = await window.djAuth.adminFetch('/api/dj/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, beforeId })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to reorder queue');
    }

    setStatus('Queue order updated.');
    if (reload) await loadQueue();
  } catch (error) {
    setStatus(error.message || 'Unable to reorder queue.', true);
    throw error;
  }
}

async function runControl(action, successLabel) {
  setControlStatus('Running control...');

  try {
    const payload = await callControlAction(action);
    if (!payload) return;

    setControlStatus(`${successLabel} (${payload.updatedCount || 0} updated).`);
    await loadQueue();
    await loadPlaybackSnapshot({ silent: true });
  } catch (error) {
    setControlStatus(error.message || 'Control action failed.', true);
  }
}

refreshAdminBtn.addEventListener('click', () => loadQueue());

playNextBtn.addEventListener('click', () => runControl('play_next_approved', 'Played next queue song'));
clearApprovedBtn.addEventListener('click', () => runControl('clear_approved', 'Queue cleared'));
clearFlaggedBtn.addEventListener('click', () => runControl('clear_pending', 'Flagged queue cleared'));
clearExplicitBtn.addEventListener('click', () => runControl('clear_denied', 'Explicit queue cleared'));
renumberBtn.addEventListener('click', () => runControl('renumber_active', 'Queue order fixed'));
clearAllBtn.addEventListener('click', () => runControl('clear_all', 'Entire queue cleared'));
refreshPlaybackBtn?.addEventListener('click', () => loadPlaybackSnapshot());
djQuickAddSearchBtn?.addEventListener('click', searchQuickAddSongs);
djQuickAddInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  searchQuickAddSongs();
});

soundCloudStartBtn?.addEventListener('click', startSoundCloudQueuePlayback);
soundCloudPlayPauseBtn?.addEventListener('click', toggleSoundCloudPlayPause);
soundCloudRestartBtn?.addEventListener('click', restartSoundCloudTrack);
soundCloudNextBtn?.addEventListener('click', advanceSoundCloudQueue);
soundCloudLoadUrlBtn?.addEventListener('click', loadManualSoundCloudUrl);
soundCloudManualUrl?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  loadManualSoundCloudUrl();
});

soundCloudProgress?.addEventListener('input', () => {
  const durationMs = Number(soundCloudState.durationMs) || 0;
  if (!durationMs) return;

  soundCloudState.isSeeking = true;
  const ratio = (Number(soundCloudProgress.value) || 0) / 1000;
  soundCloudState.positionMs = Math.round(durationMs * ratio);
  updateProgressUi();
});

soundCloudProgress?.addEventListener('change', () => {
  const durationMs = Number(soundCloudState.durationMs) || 0;
  const hasSeekableTrack = Boolean(soundCloudState.widget && soundCloudState.isReady && durationMs > 0);
  if (!hasSeekableTrack) {
    soundCloudState.isSeeking = false;
    updateProgressUi();
    return;
  }

  const ratio = (Number(soundCloudProgress.value) || 0) / 1000;
  const targetMs = Math.max(0, Math.min(durationMs, Math.round(durationMs * ratio)));
  soundCloudState.widget.seekTo(targetMs);
  soundCloudState.positionMs = targetMs;
  soundCloudState.isSeeking = false;
  updateProgressUi();
});

soundCloudProgress?.addEventListener('blur', () => {
  soundCloudState.isSeeking = false;
  updateProgressUi();
});

soundCloudVolume?.addEventListener('input', () => {
  const nextVolume = Math.max(0, Math.min(100, Number(soundCloudVolume.value) || 0));
  soundCloudState.volume = nextVolume;

  if (soundCloudState.widget && soundCloudState.isReady) {
    soundCloudState.widget.setVolume(nextVolume);
  }

  updateVolumeUi();
});

soundCloudAutoNext?.addEventListener('change', () => {
  if (soundCloudAutoNext.checked) setSoundCloudStatus('Auto-advance is enabled.');
  else setSoundCloudStatus('Auto-advance is disabled.');
});

adminLogoutBtn.addEventListener('click', () => {
  window.djAuth.clearAdminToken();
  window.location.href = '/dj/login.html';
});

enableListDrop(approvedQueueList, 'approved');
enableListDrop(flaggedQueueList, 'pending');
enableListDrop(explicitQueueList, 'rejected');

(async () => {
  const ok = await ensureAdminSession();
  if (!ok) return;

  updateVolumeUi();
  updatePlayPauseButton();
  updateProgressUi();
  await loadQueue();
  await loadPlaybackSnapshot();
  setSoundCloudStatus('Ready. Click "Start Queue Playback" to begin SoundCloud playback.');
  setInterval(() => loadQueue({ silent: true }), 8000);
  setInterval(() => loadPlaybackSnapshot({ silent: true }), 12000);
})();
