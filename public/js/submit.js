const submitSongCard = document.getElementById('submitSongCard');
const submitForm = document.getElementById('submitForm');
const submitStatus = document.getElementById('submitStatus');

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

function confidenceFromTrack(track) {
  if (track && typeof track.confidence === 'string') {
    return track.confidence;
  }

  if (track?.explicit === true) {
    return 'explicit';
  }
  if (track?.explicit === false) {
    return 'clean';
  }
  return 'unknown';
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

function setStatus(message, isError = false) {
  submitStatus.textContent = message;
  submitStatus.className = `status-message${isError ? ' error' : ''}`;
}

function renderTrack(track) {
  const confidence = confidenceFromTrack(track);
  submitSongCard.innerHTML = `
    <img src="${escapeHtml(safeImageUrl(track.albumImage))}" alt="Album art for ${escapeHtml(track.name)}">
    <div>
      <h3>${escapeHtml(track.name)}</h3>
      <p>${escapeHtml((track.artists || []).join(', '))}</p>
      <p>Album: ${escapeHtml(track.albumName || 'Unknown')}</p>
      <p>
        Content confidence:
        <span class="badge badge-confidence badge-confidence-${escapeHtml(confidence)}">${escapeHtml(confidenceLabel(confidence))}</span>
      </p>
    </div>
  `;
}

const cachedTrack = sessionStorage.getItem('selectedTrack');
if (!cachedTrack) {
  setStatus('No selected song found. Return to search and choose a song.', true);
  submitForm.querySelector('button[type="submit"]').disabled = true;
} else {
  try {
    const track = JSON.parse(cachedTrack);
    renderTrack(track);

    submitForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const requesterName = document.getElementById('requesterName').value.trim();
      const requesterRole = document.getElementById('requesterRole').value;
      const eventDate = document.getElementById('eventDate').value;
      const customMessage = document.getElementById('customMessage').value.trim();

      if (!requesterName) {
        setStatus('Requester name is required.', true);
        return;
      }

      setStatus('Submitting request...');

      try {
        const response = await fetch(window.appApi.buildApiUrl('/api/queue'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackId: track.id,
            trackName: track.name,
            artists: track.artists,
            albumName: track.albumName,
            albumImage: track.albumImage,
            spotifyUrl: track.spotifyUrl,
            explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
            requesterName,
            requesterRole,
            eventDate,
            customMessage
          })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Submit failed');
        }

        sessionStorage.removeItem('selectedTrack');
        submitForm.reset();

        if (payload.duplicateJoined) {
          setStatus('This song already exists in the pending queue. Your vote was added. Redirecting...');
        } else {
          setStatus('Request submitted successfully. Redirecting to queue view.');
        }

        setTimeout(() => {
          window.location.href = '/queue.html';
        }, 900);
      } catch (error) {
        setStatus(error.message || 'Submit failed.', true);
      }
    });
  } catch {
    setStatus('The selected song data is invalid. Search again and reselect.', true);
    submitForm.querySelector('button[type="submit"]').disabled = true;
  }
}
