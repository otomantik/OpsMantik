-- Enrich calls table with detailed matching evidence
ALTER TABLE calls 
ADD COLUMN IF NOT EXISTS lead_score_at_match INTEGER,
ADD COLUMN IF NOT EXISTS score_breakdown JSONB,
ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

-- Add index for matched_at queries
CREATE INDEX IF NOT EXISTS idx_calls_matched_at ON calls(matched_at) WHERE matched_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN calls.lead_score_at_match IS 'Lead score at the time of match (snapshot)';
COMMENT ON COLUMN calls.score_breakdown IS 'Detailed score calculation breakdown: {conversionPoints, interactionPoints, bonuses, cappedAt100}';
COMMENT ON COLUMN calls.matched_at IS 'Timestamp when match occurred';
