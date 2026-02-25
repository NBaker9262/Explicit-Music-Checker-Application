CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artists TEXT NOT NULL,
  album_name TEXT,
  album_image TEXT,
  spotify_url TEXT,
  requester_name TEXT NOT NULL,
  custom_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  review_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_submitted_at ON requests(submitted_at DESC);
