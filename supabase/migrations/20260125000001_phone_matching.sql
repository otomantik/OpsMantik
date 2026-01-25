-- Additional index for phone matching performance
-- Note: GIN indexes work on JSONB columns directly, not on text extracted with ->>
-- For text-based queries (metadata->>'fingerprint'), use B-tree indexes instead

-- B-tree index for fingerprint text queries (used in call-event route)
CREATE INDEX IF NOT EXISTS idx_events_metadata_fingerprint_text 
    ON events ((metadata->>'fingerprint'))
    WHERE metadata->>'fingerprint' IS NOT NULL;

-- B-tree index for gclid text queries
CREATE INDEX IF NOT EXISTS idx_events_metadata_gclid_text 
    ON events ((metadata->>'gclid'))
    WHERE metadata->>'gclid' IS NOT NULL;

-- GIN index on entire metadata JSONB for general JSONB queries
CREATE INDEX IF NOT EXISTS idx_events_metadata_gin 
    ON events USING GIN (metadata);
