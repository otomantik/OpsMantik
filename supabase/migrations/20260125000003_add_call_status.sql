-- Add status column to calls table for quick actions (qualified/junk)
ALTER TABLE calls 
ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('qualified', 'junk') OR status IS NULL);

-- Add index for status filtering
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status) WHERE status IS NOT NULL;
