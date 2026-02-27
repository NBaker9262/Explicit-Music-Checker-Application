const queueList = document.getElementById('queueList');
const queueStatus = document.getElementById('queueStatus');
const statusFilter = document.getElementById('statusFilter');
const refreshBtn = document.getElementById('refreshBtn');

const MODERATION_PRESETS = [
  { value: '', label: 'No preset selected' },
  { value: 'clean_version_verified', label: 'Clean version verified' },
  { value: 'duplicate_request_merged', label: 'Duplicate merged' },
  { value: 'explicit_lyrics', label: 'Explicit lyrics' },
  { value: 'violence', label: 'Violence' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'policy_violation', label: 'Policy violation' },
  { value: 'other', label: 'Other' }
];

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

function setStatus(message, isError = false) {
  queueStatus.textContent = message;
  queueStatus.className = `status-message${isError ? ' error' : ''}`;
}

function formatDate(isoDate) {
  if (!isoDate) {
    return 'Unknown';
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleString();
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function createReasonOptions(selectedReason) {
  return MODERATION_PRESETS
    .map((option) => {
      const selectedAttr = option.value === selectedReason ? 'selected' : '';
      return `<option value="${escapeHtml(option.value)}" ${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join('');
}

async function updateStatus(itemId, status, card) {
  const reasonSelect = card.querySelector('[data-field="moderationReason"]');
  const noteInput = card.querySelector('[data-field="reviewNote"]');

  const moderationReason = reasonSelect ? reasonSelect.value : '';
  const reviewNote = noteInput ? noteInput.value.trim() : '';

  if (status === 'rejected' && !moderationReason) {
    setStatus('Choose a moderation preset before rejecting a track.', true);
    return;
  }

  try {
    const response = await fetch(window.appApi.buildApiUrl(`/api/queue/${itemId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, moderationReason, reviewNote })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Status update failed');
    }

    setStatus('Queue item updated.');
    await loadQueue();
  } catch (error) {
    setStatus(error.message || 'Status update failed.', true);
  }
}

function renderQueue(items) {
  queueList.innerHTML = '';

  if (!items.length) {
    queueList.innerHTML = '<p class="empty-state">No queue items found for this filter.</p>';
    return;
  }

  items.forEach((item) => {
    const requesters = Array.isArray(item.requesters) ? item.requesters : [];
    const requesterPreview = requesters.slice(0, 3).map((entry) => `${entry.name} (${entry.role})`).join(', ');

    const card = document.createElement('article');
    card.className = 'queue-card';
    card.innerHTML = `
      <div class="queue-main">
        <img src="${escapeHtml(safeImageUrl(item.albumImage))}" alt="Album art for ${escapeHtml(item.trackName)}">
        <div>
          <h3>${escapeHtml(item.trackName)}</h3>
          <p>${escapeHtml((item.artists || []).join(', '))}</p>
          <p>Album: ${escapeHtml(item.albumName || 'Unknown')}</p>
          <p>
            Status: <span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            <span class="badge badge-confidence badge-confidence-${escapeHtml(item.contentConfidence || 'unknown')}">${escapeHtml(confidenceLabel(item.contentConfidence || 'unknown'))}</span>
            <span class="badge badge-priority badge-priority-${escapeHtml(item.priorityTier || 'low')}">Priority ${escapeHtml(item.priorityTier || 'low')} (${escapeHtml(String(item.priorityScore || 0))})</span>
          </p>
          <p>Votes: ${escapeHtml(String(item.voteCount || 1))}</p>
          <p>Requester: ${escapeHtml(item.requesterName || 'Unknown')} (${escapeHtml(item.requesterRole || 'guest')})</p>
          <p>Submitted: ${escapeHtml(formatDate(item.submittedAt))}</p>
          ${item.eventDate ? `<p>Event date: ${escapeHtml(item.eventDate)}</p>` : ''}
          ${requesterPreview ? `<p>Recent voters: ${escapeHtml(requesterPreview)}</p>` : ''}
          ${item.customMessage ? `<p>Message: ${escapeHtml(item.customMessage)}</p>` : ''}
          ${item.moderationReason ? `<p>Moderation preset: ${escapeHtml(titleCase(item.moderationReason))}</p>` : ''}
          ${item.reviewNote ? `<p>Review note: ${escapeHtml(item.reviewNote)}</p>` : ''}
        </div>
      </div>
      <div class="queue-tools">
        <label>
          Moderation preset
          <select data-field="moderationReason">${createReasonOptions(item.moderationReason || '')}</select>
        </label>
        <label>
          Review note
          <input data-field="reviewNote" type="text" maxlength="500" value="${escapeHtml(item.reviewNote || '')}" placeholder="Optional reviewer note">
        </label>
      </div>
      <div class="queue-actions">
        <button class="btn" type="button" data-action="pending">Pending</button>
        <button class="btn" type="button" data-action="approved">Approve</button>
        <button class="btn" type="button" data-action="rejected">Reject</button>
      </div>
    `;

    card.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => updateStatus(item.id, button.dataset.action, card));
    });

    queueList.appendChild(card);
  });
}

async function loadQueue() {
  const filter = statusFilter.value;
  const query = filter ? `?status=${encodeURIComponent(filter)}` : '';

  setStatus('Loading queue...');

  try {
    const response = await fetch(window.appApi.buildApiUrl(`/api/queue${query}`));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load queue');
    }

    const items = payload.items || [];
    renderQueue(items);
    setStatus(`Loaded ${items.length} item(s).`);
  } catch (error) {
    setStatus(error.message || 'Unable to load queue.', true);
  }
}

statusFilter.addEventListener('change', loadQueue);
refreshBtn.addEventListener('click', loadQueue);

loadQueue();
