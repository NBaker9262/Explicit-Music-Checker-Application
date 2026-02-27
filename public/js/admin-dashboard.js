const adminStatusMessage = document.getElementById('adminStatusMessage');
const adminAnalyticsStatus = document.getElementById('adminAnalyticsStatus');
const adminQueueList = document.getElementById('adminQueueList');
const adminTotalsGrid = document.getElementById('adminTotalsGrid');
const adminTopArtists = document.getElementById('adminTopArtists');
const adminTopTracks = document.getElementById('adminTopTracks');
const adminDanceMoments = document.getElementById('adminDanceMoments');
const adminVibeTags = document.getElementById('adminVibeTags');

const adminStatusFilter = document.getElementById('adminStatusFilter');
const adminConfidenceFilter = document.getElementById('adminConfidenceFilter');
const adminMomentFilter = document.getElementById('adminMomentFilter');
const adminSearchInput = document.getElementById('adminSearchInput');

const refreshAdminBtn = document.getElementById('refreshAdminBtn');
const bulkApproveBtn = document.getElementById('bulkApproveBtn');
const bulkRejectBtn = document.getElementById('bulkRejectBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

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

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function confidenceLabel(confidence) {
  if (confidence === 'clean') return 'Clean confidence';
  if (confidence === 'explicit') return 'Explicit confidence';
  return 'Unknown confidence';
}

function setStatus(message, isError = false) {
  adminStatusMessage.textContent = message;
  adminStatusMessage.className = `status-message${isError ? ' error' : ''}`;
}

function setAnalyticsStatus(message, isError = false) {
  adminAnalyticsStatus.textContent = message;
  adminAnalyticsStatus.className = `status-message${isError ? ' error' : ''}`;
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

function buildQueueQuery() {
  const params = new URLSearchParams();
  if (adminStatusFilter.value) params.set('status', adminStatusFilter.value);
  if (adminConfidenceFilter.value) params.set('confidence', adminConfidenceFilter.value);
  if (adminMomentFilter.value) params.set('danceMoment', adminMomentFilter.value);
  if (adminSearchInput.value.trim()) params.set('q', adminSearchInput.value.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function updateItem(itemId, card) {
  const status = card.querySelector('[data-field="status"]').value;
  const moderationReason = card.querySelector('[data-field="moderationReason"]').value;
  const reviewNote = card.querySelector('[data-field="reviewNote"]').value.trim();
  const danceMoment = card.querySelector('[data-field="danceMoment"]').value;
  const energyLevel = Number(card.querySelector('[data-field="energyLevel"]').value);
  const setOrderRaw = card.querySelector('[data-field="setOrder"]').value.trim();
  const djNotes = card.querySelector('[data-field="djNotes"]').value.trim();

  const payload = {
    status,
    moderationReason,
    reviewNote,
    danceMoment,
    energyLevel,
    setOrder: setOrderRaw === '' ? null : Number(setOrderRaw),
    djNotes
  };

  try {
    const response = await window.adminAuth.adminFetch(`/api/admin/queue/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Update failed');
    }

    setStatus(`Updated ${result.trackName}.`);
    await Promise.all([loadQueue(), loadAnalytics()]);
  } catch (error) {
    setStatus(error.message || 'Update failed.', true);
  }
}

function renderQueue(items) {
  adminQueueList.innerHTML = '';

  if (!items.length) {
    adminQueueList.innerHTML = '<p class="empty-state">No queue items match your filters.</p>';
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
          <p>
            <span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            <span class="badge badge-priority badge-priority-${escapeHtml(item.priorityTier || 'low')}">Priority ${escapeHtml(item.priorityTier || 'low')} (${escapeHtml(String(item.priorityScore || 0))})</span>
            <span class="badge badge-confidence badge-confidence-${escapeHtml(item.contentConfidence || 'unknown')}">${escapeHtml(confidenceLabel(item.contentConfidence || 'unknown'))}</span>
          </p>
          <p>Votes: ${escapeHtml(String(item.voteCount || 1))} | Moment: ${escapeHtml(titleCase(item.danceMoment || 'anytime'))} | Energy: ${escapeHtml(String(item.energyLevel || 3))}</p>
          <p>Requester: ${escapeHtml(item.requesterName || 'Unknown')} (${escapeHtml(item.requesterRole || 'guest')})</p>
          ${item.eventDate ? `<p>Event date: ${escapeHtml(item.eventDate)}</p>` : ''}
          ${item.dedicationMessage ? `<p>Dedication: ${escapeHtml(item.dedicationMessage)}</p>` : ''}
        </div>
      </div>
      <div class="queue-tools">
        <label>Status
          <select data-field="status">
            <option value="pending" ${item.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="approved" ${item.status === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${item.status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </label>
        <label>Moderation preset
          <select data-field="moderationReason">
            <option value="" ${!item.moderationReason ? 'selected' : ''}>None</option>
            <option value="clean_version_verified" ${item.moderationReason === 'clean_version_verified' ? 'selected' : ''}>Clean Version Verified</option>
            <option value="duplicate_request_merged" ${item.moderationReason === 'duplicate_request_merged' ? 'selected' : ''}>Duplicate Request Merged</option>
            <option value="explicit_lyrics" ${item.moderationReason === 'explicit_lyrics' ? 'selected' : ''}>Explicit Lyrics</option>
            <option value="violence" ${item.moderationReason === 'violence' ? 'selected' : ''}>Violence</option>
            <option value="hate_speech" ${item.moderationReason === 'hate_speech' ? 'selected' : ''}>Hate Speech</option>
            <option value="sexual_content" ${item.moderationReason === 'sexual_content' ? 'selected' : ''}>Sexual Content</option>
            <option value="policy_violation" ${item.moderationReason === 'policy_violation' ? 'selected' : ''}>Policy Violation</option>
            <option value="other" ${item.moderationReason === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </label>
        <label>Dance moment
          <select data-field="danceMoment">
            <option value="anytime" ${item.danceMoment === 'anytime' ? 'selected' : ''}>Anytime</option>
            <option value="grand_entrance" ${item.danceMoment === 'grand_entrance' ? 'selected' : ''}>Grand Entrance</option>
            <option value="warmup" ${item.danceMoment === 'warmup' ? 'selected' : ''}>Warmup</option>
            <option value="peak_hour" ${item.danceMoment === 'peak_hour' ? 'selected' : ''}>Peak Hour</option>
            <option value="slow_dance" ${item.danceMoment === 'slow_dance' ? 'selected' : ''}>Slow Dance</option>
            <option value="last_dance" ${item.danceMoment === 'last_dance' ? 'selected' : ''}>Last Dance</option>
          </select>
        </label>
        <label>Energy
          <input data-field="energyLevel" type="number" min="1" max="5" value="${escapeHtml(String(item.energyLevel || 3))}">
        </label>
        <label>Set order
          <input data-field="setOrder" type="number" min="1" max="9999" value="${item.setOrder === null ? '' : escapeHtml(String(item.setOrder))}">
        </label>
      </div>
      <div class="queue-tools">
        <label>Review note
          <input data-field="reviewNote" type="text" maxlength="500" value="${escapeHtml(item.reviewNote || '')}">
        </label>
        <label>DJ notes
          <input data-field="djNotes" type="text" maxlength="500" value="${escapeHtml(item.djNotes || '')}">
        </label>
      </div>
      <div class="queue-actions">
        <button class="btn btn-primary" type="button" data-action="save">Save Changes</button>
      </div>
    `;

    card.querySelector('[data-action="save"]').addEventListener('click', () => updateItem(item.id, card));
    adminQueueList.appendChild(card);
  });
}

function renderTotals(totals) {
  const cards = [
    { label: 'Total Requests', value: totals.requests ?? 0 },
    { label: 'Votes', value: totals.votes ?? 0 },
    { label: 'Approval Rate', value: `${totals.approvalRate ?? 0}%` },
    { label: 'Average Priority', value: totals.averagePriorityScore ?? 0 },
    { label: 'Average Energy', value: totals.averageEnergyLevel ?? 0 },
    { label: 'Pending High Priority', value: totals.pendingHighPriority ?? 0 }
  ];

  adminTotalsGrid.innerHTML = cards.map((card) => `
    <article class="analytics-card">
      <p class="analytics-card-label">${escapeHtml(card.label)}</p>
      <p class="analytics-card-value">${escapeHtml(String(card.value))}</p>
    </article>
  `).join('');
}

function renderAnalyticsList(target, items, labelKey, valueKey = 'votes') {
  if (!items || !items.length) {
    target.innerHTML = '<p class="empty-state">No data yet.</p>';
    return;
  }

  target.innerHTML = items.slice(0, 8).map((entry, index) => {
    const label = labelKey === 'trackName' ? entry.trackName : entry[labelKey];
    return `<p>${index + 1}. ${escapeHtml(titleCase(label))} <strong>${escapeHtml(String(entry[valueKey] ?? 0))}</strong></p>`;
  }).join('');
}

async function loadQueue() {
  setStatus('Loading queue...');

  try {
    const response = await window.adminAuth.adminFetch(`/api/admin/queue${buildQueueQuery()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load queue');
    }

    renderQueue(payload.items || []);
    setStatus(`Loaded ${payload.items?.length || 0} item(s).`);
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('401')) {
      window.adminAuth.clearAdminToken();
      window.location.href = '/admin/login.html';
      return;
    }
    setStatus(error.message || 'Unable to load queue.', true);
  }
}

async function loadAnalytics() {
  setAnalyticsStatus('Loading analytics...');

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/analytics');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load analytics');
    }

    renderTotals(payload.totals || {});
    renderAnalyticsList(adminTopArtists, payload.topRequestedArtists || [], 'artist');
    renderAnalyticsList(adminTopTracks, payload.topRequestedTracks || [], 'trackName');
    renderAnalyticsList(adminDanceMoments, payload.danceMoments || [], 'danceMoment');
    renderAnalyticsList(adminVibeTags, payload.vibeTags || [], 'tag');
    setAnalyticsStatus('Analytics updated.');
  } catch (error) {
    setAnalyticsStatus(error.message || 'Unable to load analytics.', true);
  }
}

async function runBulkAction(action) {
  setStatus('Running bulk action...');

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Bulk action failed');
    }

    setStatus(`Bulk action updated ${payload.updatedCount} item(s).`);
    await Promise.all([loadQueue(), loadAnalytics()]);
  } catch (error) {
    setStatus(error.message || 'Bulk action failed.', true);
  }
}

refreshAdminBtn.addEventListener('click', () => {
  loadQueue();
  loadAnalytics();
});

adminStatusFilter.addEventListener('change', loadQueue);
adminConfidenceFilter.addEventListener('change', loadQueue);
adminMomentFilter.addEventListener('change', loadQueue);
adminSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadQueue();
  }
});

bulkApproveBtn.addEventListener('click', () => runBulkAction('approve_clean_high_priority'));
bulkRejectBtn.addEventListener('click', () => runBulkAction('reject_explicit'));

adminLogoutBtn.addEventListener('click', () => {
  window.adminAuth.clearAdminToken();
  window.location.href = '/admin/login.html';
});

(async () => {
  const ok = await ensureAdminSession();
  if (!ok) return;
  await Promise.all([loadQueue(), loadAnalytics()]);
})();
