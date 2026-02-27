-- Add state machine metadata columns to calls table
ALTER TABLE public.calls 
ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_fast_tracked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days';

-- Add comments for documentation
COMMENT ON COLUMN public.calls.last_status_change_at IS 'Tracks when the lead status last changed for state machine timing.';
COMMENT ON COLUMN public.calls.is_fast_tracked IS 'True if the lead was automatically qualified via Brain Score (>= 80).';
COMMENT ON COLUMN public.calls.expires_at IS 'Timestamp after which a pending lead is considered stale and subject to auto-junking.';

-- Function to automatically update last_status_change_at
CREATE OR REPLACE FUNCTION public.handle_call_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        NEW.last_status_change_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to fire the function
DROP TRIGGER IF EXISTS trg_calls_last_status_change ON public.calls;
CREATE TRIGGER trg_calls_last_status_change
    BEFORE UPDATE ON public.calls
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_call_status_change();

-- Index for the auto-junk cron job optimization
CREATE INDEX IF NOT EXISTS idx_calls_status_expires_at ON public.calls(status, expires_at) 
WHERE status = 'pending';
