const adminStatusMessage = document.getElementById('adminStatusMessage');
const adminControlStatus = document.getElementById('adminControlStatus');
const approvedQueueList = document.getElementById('approvedQueueList');
const flaggedQueueList = document.getElementById('flaggedQueueList');
const explicitQueueList = document.getElementById('explicitQueueList');

const refreshAdminBtn = document.getElementById('refreshAdminBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

const playNextBtn = document.getElementById('playNextBtn');
const clearApprovedBtn = document.getElementById('clearApprovedBtn');
const clearFlaggedBtn = document.getElementById('clearFlaggedBtn');
const clearExplicitBtn = document.getElementById('clearExplicitBtn');
const renumberBtn = document.getElementById('renumberBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

let dragItemId = null;

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

async function ensureAdminSession() {
  if (!window.adminAuth.getAdminToken()) {
    window.location.href = '/admin/login.html';
    return false;
  }

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/session');
    if (!response.ok) {
      window.adminAuth.clearAdminToken();
      window.location.href = '/admin/login.html';
      return false;
    }
    return true;
  } catch {
    window.adminAuth.clearAdminToken();
    window.location.href = '/admin/login.html';
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
      <button class="btn" type="button" data-action="flagged">Flag</button>
      <button class="btn btn-danger" type="button" data-action="deny">Mark Explicit</button>
    `;
  }

  if (item.status === 'pending') {
    return `
      <button class="btn btn-primary" type="button" data-action="approve">Move To Queue</button>
      <button class="btn btn-danger" type="button" data-action="deny">Mark Explicit</button>
    `;
  }

  return `
    <button class="btn btn-primary" type="button" data-action="approve">Move To Queue</button>
  `;
}

function attachRowEvents(row, item) {
  const approveBtn = row.querySelector('[data-action="approve"]');
  const flaggedBtn = row.querySelector('[data-action="flagged"]');
  const denyBtn = row.querySelector('[data-action="deny"]');

  if (approveBtn) {
    approveBtn.addEventListener('click', () => updateStatus(item.id, 'approved', ''));
  }
  if (flaggedBtn) {
    flaggedBtn.addEventListener('click', () => updateStatus(item.id, 'pending', ''));
  }
  if (denyBtn) {
    denyBtn.addEventListener('click', () => updateStatus(item.id, 'rejected', 'explicit_lyrics'));
  }

  if (item.status === 'rejected') return;

  row.draggable = true;
  row.classList.add('draggable-row');

  row.addEventListener('dragstart', (event) => {
    dragItemId = item.id;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(item.id));
  });

  row.addEventListener('dragend', () => {
    dragItemId = null;
    row.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach((entry) => entry.classList.remove('drop-target'));
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
    await reorderQueue(dragItemId, item.id);
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

  const dragLabel = item.status === 'rejected'
    ? ''
    : '<span class="drag-label">Drag</span>';

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

function renderSection(listEl, items, emptyMessage) {
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  items.forEach((item) => {
    listEl.appendChild(createQueueRow(item));
  });
}

function enableListDrop(listEl) {
  listEl.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  listEl.addEventListener('drop', async (event) => {
    event.preventDefault();
    if (dragItemId === null) return;
    await reorderQueue(dragItemId, null);
  });
}

async function loadQueue() {
  setStatus('Loading queue...');

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/queue');
    const payload = await response.json();

    if (response.status === 401) {
      window.adminAuth.clearAdminToken();
      window.location.href = '/admin/login.html';
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load queue');
    }

    const items = payload.items || [];
    const sections = splitQueue(items);
    renderSection(approvedQueueList, sections.queue, 'No songs in queue.');
    renderSection(flaggedQueueList, sections.flagged, 'No flagged songs.');
    renderSection(explicitQueueList, sections.explicit, 'No explicit songs.');
    setStatus(`Queue loaded. ${items.length} total songs.`);
  } catch (error) {
    setStatus(error.message || 'Unable to load queue.', true);
  }
}

async function updateStatus(itemId, status, moderationReason) {
  setStatus('Saving changes...');

  const payload = status === 'rejected'
    ? { status, moderationReason: moderationReason || 'other' }
    : { status, moderationReason: '' };

  try {
    const response = await window.adminAuth.adminFetch(`/api/admin/queue/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Unable to update song');
    }

    setStatus(`Updated: ${result.trackName}`);
    await loadQueue();
  } catch (error) {
    setStatus(error.message || 'Unable to update song.', true);
  }
}

async function reorderQueue(itemId, beforeId) {
  setStatus('Updating order...');

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, beforeId })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to reorder queue');
    }

    setStatus('Queue order updated.');
    await loadQueue();
  } catch (error) {
    setStatus(error.message || 'Unable to reorder queue.', true);
  }
}

async function runControl(action, successLabel) {
  setControlStatus('Running control...');

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Control action failed');
    }

    setControlStatus(`${successLabel} (${payload.updatedCount || 0} updated).`);
    await loadQueue();
  } catch (error) {
    setControlStatus(error.message || 'Control action failed.', true);
  }
}

refreshAdminBtn.addEventListener('click', loadQueue);

playNextBtn.addEventListener('click', () => runControl('play_next_approved', 'Played next queue song'));
clearApprovedBtn.addEventListener('click', () => runControl('clear_approved', 'Queue cleared'));
clearFlaggedBtn.addEventListener('click', () => runControl('clear_pending', 'Flagged queue cleared'));
clearExplicitBtn.addEventListener('click', () => runControl('clear_denied', 'Explicit queue cleared'));
renumberBtn.addEventListener('click', () => runControl('renumber_active', 'Queue order fixed'));
clearAllBtn.addEventListener('click', () => runControl('clear_all', 'Entire queue cleared'));

adminLogoutBtn.addEventListener('click', () => {
  window.adminAuth.clearAdminToken();
  window.location.href = '/admin/login.html';
});

enableListDrop(approvedQueueList);
enableListDrop(flaggedQueueList);

(async () => {
  const ok = await ensureAdminSession();
  if (!ok) return;
  await loadQueue();
  setInterval(loadQueue, 8000);
})();
