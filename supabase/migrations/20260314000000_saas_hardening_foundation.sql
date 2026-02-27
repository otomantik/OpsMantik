-- Migration: Add FATAL status to OCI queue and daily quotas to sites
-- and last_status_change_at trigger (missing from previous)

-- 1. Extend offline_conversion_queue status check (text column, not enum)
ALTER TABLE public.offline_conversion_queue DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;
ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check
  CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY', 'FATAL'));

-- 2. Add daily_lead_limit to sites
ALTER TABLE public.sites
ADD COLUMN IF NOT EXISTS daily_lead_limit INTEGER DEFAULT 1000;

-- 3. Fix missing trigger for last_status_change_at (from previous cycle)
CREATE OR REPLACE FUNCTION public.fn_update_last_status_change_at()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        NEW.last_status_change_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calls_last_status_change ON public.calls;
CREATE TRIGGER trg_calls_last_status_change
BEFORE UPDATE ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_last_status_change_at();

COMMENT ON COLUMN public.sites.daily_lead_limit IS 'Max number of leads per 24h before 429 rate limiting.';
