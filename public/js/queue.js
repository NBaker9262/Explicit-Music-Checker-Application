const queueList = document.getElementById('queueList');
const queueStatus = document.getElementById('queueStatus');
const statusFilter = document.getElementById('statusFilter');
const refreshBtn = document.getElementById('refreshBtn');

function setStatus(message, isError = false) {
    queueStatus.textContent = message;
    queueStatus.className = `status-message${isError ? ' error' : ''}`;
}

function formatDate(isoDate) {
    return new Date(isoDate).toLocaleString();
}

async function updateStatus(itemId, status) {
    let reviewNote = '';

    if (status === 'rejected') {
        reviewNote = window.prompt('Add a short reason for rejection (optional):', '') || '';
    }

    try {
        const response = await fetch(window.appApi.buildApiUrl(`/api/queue/${itemId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, reviewNote })
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
        const card = document.createElement('article');
        card.className = 'queue-card';
        card.innerHTML = `
            <div class="queue-main">
                <img src="${item.albumImage || ''}" alt="Album art for ${item.trackName}">
                <div>
                    <h3>${item.trackName}</h3>
                    <p>${item.artists.join(', ')}</p>
                    <p>Album: ${item.albumName || 'Unknown'}</p>
                    <p>Requester: ${item.requesterName}</p>
                    <p>Status: <span class="badge badge-${item.status}">${item.status}</span></p>
                    <p>Submitted: ${formatDate(item.submittedAt)}</p>
                    ${item.customMessage ? `<p>Message: ${item.customMessage}</p>` : ''}
                    ${item.reviewNote ? `<p>Review note: ${item.reviewNote}</p>` : ''}
                </div>
            </div>
            <div class="queue-actions">
                <button class="btn" type="button" data-action="pending">Pending</button>
                <button class="btn" type="button" data-action="approved">Approve</button>
                <button class="btn" type="button" data-action="rejected">Reject</button>
            </div>
        `;

        card.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => updateStatus(item.id, button.dataset.action));
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
