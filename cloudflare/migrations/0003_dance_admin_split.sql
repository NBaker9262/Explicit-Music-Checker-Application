ALTER TABLE requests ADD COLUMN dance_moment TEXT NOT NULL DEFAULT 'anytime';
ALTER TABLE requests ADD COLUMN energy_level INTEGER NOT NULL DEFAULT 3;
ALTER TABLE requests ADD COLUMN vibe_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE requests ADD COLUMN dedication_message TEXT;
ALTER TABLE requests ADD COLUMN dj_notes TEXT;
ALTER TABLE requests ADD COLUMN set_order INTEGER;

UPDATE requests
SET dance_moment = 'anytime'
WHERE dance_moment IS NULL OR dance_moment = '';

UPDATE requests
SET energy_level = 3
WHERE energy_level IS NULL OR energy_level < 1 OR energy_level > 5;

UPDATE requests
SET vibe_tags = '[]'
WHERE vibe_tags IS NULL OR vibe_tags = '';

UPDATE requests
SET dedication_message = ''
WHERE dedication_message IS NULL;

UPDATE requests
SET dj_notes = ''
WHERE dj_notes IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_set_order ON requests(set_order ASC);
CREATE INDEX IF NOT EXISTS idx_requests_dance_moment ON requests(dance_moment);
