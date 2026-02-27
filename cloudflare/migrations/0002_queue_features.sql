ALTER TABLE requests ADD COLUMN requester_role TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE requests ADD COLUMN event_date TEXT;
ALTER TABLE requests ADD COLUMN explicit_flag INTEGER;
ALTER TABLE requests ADD COLUMN content_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK(content_confidence IN ('clean','explicit','unknown'));
ALTER TABLE requests ADD COLUMN moderation_reason TEXT;
ALTER TABLE requests ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE requests ADD COLUMN requesters_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE requests ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 0;

UPDATE requests
SET requester_role = COALESCE(NULLIF(requester_role, ''), 'guest');

UPDATE requests
SET content_confidence = CASE
  WHEN explicit_flag = 1 THEN 'explicit'
  WHEN explicit_flag = 0 THEN 'clean'
  ELSE 'unknown'
END
WHERE content_confidence IS NULL OR content_confidence = '';

UPDATE requests
SET vote_count = 1
WHERE vote_count IS NULL OR vote_count < 1;

UPDATE requests
SET requesters_json = json_array(
  json_object(
    'name', requester_name,
    'role', requester_role,
    'customMessage', COALESCE(custom_message, ''),
    'submittedAt', COALESCE(submitted_at, datetime('now'))
  )
)
WHERE (requesters_json IS NULL OR requesters_json = '[]')
  AND requester_name IS NOT NULL
  AND requester_name <> '';

UPDATE requests
SET priority_score = MIN(100, MAX(0, vote_count * 6))
WHERE priority_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_track_pending ON requests(track_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_priority ON requests(priority_score DESC, vote_count DESC);
