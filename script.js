// Data storage
let songRequests = [];

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeForm();
    loadSampleData();
    renderRequestList();
    renderVettingList();
});

// Navigation
function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    
    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            const pageId = this.dataset.page;
            switchPage(pageId);
        });
    });
}

function switchPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    document.getElementById(pageId).classList.add('active');
    
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.page === pageId) {
            btn.classList.add('active');
        }
    });
}

// Form handling
function initializeForm() {
    const form = document.getElementById('requestForm');
    
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const newRequest = {
            id: Date.now(),
            title: document.getElementById('songTitle').value,
            artist: document.getElementById('artistName').value,
            requester: document.getElementById('requesterName').value,
            link: document.getElementById('songLink').value,
            notes: document.getElementById('notes').value,
            status: 'pending',
            submittedAt: new Date().toLocaleDateString(),
            contentFindings: null
        };
        
        songRequests.push(newRequest);
        form.reset();
        
        // Show success message
        showNotification('Song request submitted successfully!', 'success');
        
        // Refresh lists
        renderRequestList();
        renderVettingList();
    });
}

// Render request list
function renderRequestList() {
    const container = document.getElementById('requestItems');
    
    if (songRequests.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">No requests yet</div></div>';
        return;
    }
    
    container.innerHTML = songRequests.map(request => `
        <div class="item-card">
            <div class="item-title">${escapeHtml(request.title)}</div>
            <div class="item-artist">by ${escapeHtml(request.artist)}</div>
            <div class="item-requester">Requested by: ${escapeHtml(request.requester)}</div>
            <span class="item-status status-${request.status}">${request.status.charAt(0).toUpperCase() + request.status.slice(1)}</span>
            <div class="item-requester">Submitted: ${request.submittedAt}</div>
            ${request.notes ? `<div class="item-notes">"${escapeHtml(request.notes)}"</div>` : ''}
            ${request.link ? `<div class="item-requester"><a href="${request.link}" target="_blank">🔗 Song Link</a></div>` : ''}
        </div>
    `).join('');
}

// Render vetting list
function renderVettingList() {
    const container = document.getElementById('vettingItems');
    const filterStatus = document.getElementById('statusFilter').value;
    
    let filteredRequests = songRequests;
    if (filterStatus) {
        filteredRequests = songRequests.filter(req => req.status === filterStatus);
    }
    
    if (filteredRequests.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-text">No songs to review</div></div>';
        return;
    }
    
    container.innerHTML = filteredRequests.map(request => `
        <div class="item-card">
            <div class="item-title">${escapeHtml(request.title)}</div>
            <div class="item-artist">by ${escapeHtml(request.artist)}</div>
            <div class="item-requester">Requested by: ${escapeHtml(request.requester)}</div>
            <span class="item-status status-${request.status}">${request.status.charAt(0).toUpperCase() + request.status.slice(1)}</span>
            ${request.notes ? `<div class="item-requester">Notes: ${escapeHtml(request.notes)}</div>` : ''}
            ${request.contentFindings ? `
                <div class="item-content-findings">
                    <strong>⚠️ Content Check:</strong><br>${escapeHtml(request.contentFindings)}
                </div>
            ` : ''}
            <div class="button-group">
                <button class="btn btn-approve" onclick="approveRequest(${request.id})">✓ Approve</button>
                <button class="btn btn-reject" onclick="rejectRequest(${request.id})">✗ Reject</button>
            </div>
        </div>
    `).join('');
}

// Approve request
function approveRequest(id) {
    const request = songRequests.find(r => r.id === id);
    if (request) {
        request.status = 'approved';
        request.contentFindings = null;
        renderVettingList();
        renderRequestList();
        showNotification('✓ Song approved!', 'success');
    }
}

// Reject request
function rejectRequest(id) {
    const findings = prompt('Add content findings (reason for rejection):');
    if (findings !== null) {
        const request = songRequests.find(r => r.id === id);
        if (request) {
            request.status = 'rejected';
            request.contentFindings = findings || 'Contains inappropriate content';
            renderVettingList();
            renderRequestList();
            showNotification('✗ Song rejected', 'warning');
        }
    }
}

// Filter vetting list
document.addEventListener('DOMContentLoaded', function() {
    const filterSelect = document.getElementById('statusFilter');
    if (filterSelect) {
        filterSelect.addEventListener('change', renderVettingList);
    }
});

// Notification
function showNotification(message, type = 'info') {
    // Simple notification - could be enhanced with a toast library
    alert(message);
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load sample data for demo
function loadSampleData() {
    if (songRequests.length === 0) {
        songRequests = [
            {
                id: 1,
                title: 'Uptown DJs',
                artist: 'Mark Ronson ft. Bruno Mars',
                requester: 'John Smith',
                link: 'https://example.com/song1',
                notes: 'Great for dancing!',
                status: 'approved',
                submittedAt: '2/8/2026',
                contentFindings: null
            },
            {
                id: 2,
                title: 'In My Feelings',
                artist: 'Drake',
                requester: 'Sarah Johnson',
                link: '',
                notes: '',
                status: 'pending',
                submittedAt: '2/9/2026',
                contentFindings: null
            },
            {
                id: 3,
                title: 'Old Town Road',
                artist: 'Lil Nas X',
                requester: 'Mike Davis',
                link: 'https://example.com/song3',
                notes: 'Popular request',
                status: 'rejected',
                submittedAt: '2/7/2026',
                contentFindings: 'Contains explicit language'
            }
        ];
    }
}
