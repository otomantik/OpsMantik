-- Migration: Auto-increment version on calls update
-- This ensures optimistic locking is handled correctly regardless of the caller.

CREATE OR REPLACE FUNCTION public.fn_increment_calls_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Only increment if the application hasn't already manually incremented it
    -- or if we want to enforce it always. Enforcing it always is safer for "Global SaaS".
    IF NEW.version <= OLD.version THEN
        NEW.version = OLD.version + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calls_version_increment ON public.calls;
CREATE TRIGGER trg_calls_version_increment
BEFORE UPDATE ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.fn_increment_calls_version();

COMMENT ON FUNCTION public.fn_increment_calls_version IS 'Automatically increments the version column for optimistic locking on update.';
