# Explicit-Music-Checker-Application
An app for searching Spotify tracks, selecting an exact song, submitting a request, and managing a review queue.

## Current flow

1. Search for a song on the main page (`/`).
2. Select one track from Spotify search results.
3. Continue to the submit page (`/submit.html`) and add requester name and optional custom message.
4. Submit to the server queue.
5. Review queue items on `/queue.html` and mark status as pending, approved, or rejected.

## Notes

- The legacy UI has been archived to `archive/old-legacy`.
- Queue data is currently stored in memory on the server and resets when the server restarts.
