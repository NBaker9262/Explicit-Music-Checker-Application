const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');

searchBtn.addEventListener('click', async () => {
    const query = searchInput.value;
    if (!query) return;

    // Example: search Spotify
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    resultsDiv.innerHTML = '';
    if (data.tracks && data.tracks.items) {
        data.tracks.items.forEach(track => {
            const div = document.createElement('div');
            div.classList.add('song-card');
            div.innerHTML = `
                <img src="${track.album.images[0]?.url || ''}" width="80">
                <p>${track.name} - ${track.artists[0].name}</p>
            `;
            resultsDiv.appendChild(div);
        });
    }
});