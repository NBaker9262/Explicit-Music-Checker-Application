const submitSongCard = document.getElementById('submitSongCard');
const submitForm = document.getElementById('submitForm');
const submitStatus = document.getElementById('submitStatus');

function setStatus(message, isError = false) {
    submitStatus.textContent = message;
    submitStatus.className = `status-message${isError ? ' error' : ''}`;
}

function renderTrack(track) {
    submitSongCard.innerHTML = `
        <img src="${track.albumImage || ''}" alt="Album art for ${track.name}">
        <div>
            <h3>${track.name}</h3>
            <p>${track.artists.join(', ')}</p>
            <p>Album: ${track.albumName || 'Unknown'}</p>
            <p>Explicit: ${track.explicit ? 'Yes' : 'No'}</p>
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
                        requesterName,
                        customMessage
                    })
                });

                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || 'Submit failed');
                }

                sessionStorage.removeItem('selectedTrack');
                submitForm.reset();
                setStatus('Request submitted successfully. Redirecting to queue view.');
                setTimeout(() => {
                    window.location.href = '/queue.html';
                }, 700);
            } catch (error) {
                setStatus(error.message || 'Submit failed.', true);
            }
        });
    } catch (error) {
        setStatus('The selected song data is invalid. Search again and reselect.', true);
        submitForm.querySelector('button[type="submit"]').disabled = true;
    }
}
