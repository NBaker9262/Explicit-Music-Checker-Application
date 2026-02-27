const analyticsStatus = document.getElementById('analyticsStatus');
const refreshAnalyticsBtn = document.getElementById('refreshAnalyticsBtn');
const totalsGrid = document.getElementById('totalsGrid');
const statusBreakdown = document.getElementById('statusBreakdown');
const topArtists = document.getElementById('topArtists');
const rejectedTracks = document.getElementById('rejectedTracks');
const moderationReasons = document.getElementById('moderationReasons');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(message, isError = false) {
  analyticsStatus.textContent = message;
  analyticsStatus.className = `status-message${isError ? ' error' : ''}`;
}

function renderTotals(totals) {
  const cards = [
    { label: 'Total Requests', value: totals.requests ?? 0 },
    { label: 'Total Votes', value: totals.votes ?? 0 },
    { label: 'Approved Votes', value: totals.approvedVotes ?? 0 },
    { label: 'Approval Rate', value: `${totals.approvalRate ?? 0}%` },
    { label: 'Avg Priority Score', value: totals.averagePriorityScore ?? 0 }
  ];

  totalsGrid.innerHTML = cards
    .map((card) => {
      return `
        <article class="analytics-card">
          <p class="analytics-card-label">${escapeHtml(card.label)}</p>
          <p class="analytics-card-value">${escapeHtml(String(card.value))}</p>
        </article>
      `;
    })
    .join('');
}

function renderStatusBreakdown(items) {
  const rows = Object.entries(items || {});
  if (!rows.length) {
    statusBreakdown.innerHTML = '<p class="empty-state">No status data available.</p>';
    return;
  }

  statusBreakdown.innerHTML = rows
    .map(([status, value]) => `<p><span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span> ${escapeHtml(String(value))} vote(s)</p>`)
    .join('');
}

function renderTopArtists(items) {
  if (!items || !items.length) {
    topArtists.innerHTML = '<p class="empty-state">No artist data available.</p>';
    return;
  }

  topArtists.innerHTML = items
    .map((item, index) => `<p>${index + 1}. ${escapeHtml(item.artist)} <strong>${escapeHtml(String(item.votes))}</strong></p>`)
    .join('');
}

function renderRejectedTracks(items) {
  if (!items || !items.length) {
    rejectedTracks.innerHTML = '<p class="empty-state">No rejected tracks yet.</p>';
    return;
  }

  rejectedTracks.innerHTML = items
    .map((item, index) => {
      return `<p>${index + 1}. ${escapeHtml(item.trackName)} - ${escapeHtml(String(item.rejectedVotes))} rejected vote(s)</p>`;
    })
    .join('');
}

function renderModerationReasons(items) {
  if (!items || !items.length) {
    moderationReasons.innerHTML = '<p class="empty-state">No moderation presets used yet.</p>';
    return;
  }

  moderationReasons.innerHTML = items
    .map((item, index) => `<p>${index + 1}. ${escapeHtml(item.reason.replace(/_/g, ' '))} <strong>${escapeHtml(String(item.count))}</strong></p>`)
    .join('');
}

async function loadAnalytics() {
  setStatus('Loading analytics...');

  try {
    const response = await fetch(window.appApi.buildApiUrl('/api/analytics'));
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load analytics');
    }

    renderTotals(payload.totals || {});
    renderStatusBreakdown(payload.statusBreakdown || {});
    renderTopArtists(payload.topRequestedArtists || []);
    renderRejectedTracks(payload.mostRejectedTracks || []);
    renderModerationReasons(payload.moderationReasons || []);
    setStatus('Analytics loaded.');
  } catch (error) {
    setStatus(error.message || 'Unable to load analytics.', true);
  }
}

refreshAnalyticsBtn.addEventListener('click', loadAnalytics);
loadAnalytics();
