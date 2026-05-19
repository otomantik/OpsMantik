-- Intent retention: 90-day TTL, auto-junk only untouched intent rows (human-first queue).

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN public.calls.expires_at IS
  'After this time untouched intent rows may be auto-junked (default set at insert: created_at + 90d).';

CREATE OR REPLACE FUNCTION public.fn_set_standard_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NOW() + INTERVAL '90 days';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_set_standard_expires_at() IS
  'Sets calls.expires_at to now+90d on insert when unset. SSOT for auto-junk eligibility window.';

DROP TRIGGER IF EXISTS trg_calls_standard_expiration ON public.calls;
CREATE TRIGGER trg_calls_standard_expiration
  BEFORE INSERT ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_standard_expires_at();

-- Backfill untouched intent queue: full 90d window from lead creation.
UPDATE public.calls
SET
  expires_at = created_at + INTERVAL '90 days',
  updated_at = NOW()
WHERE status = 'intent'
  AND reviewed_at IS NULL
  AND expires_at IS NULL;

CREATE OR REPLACE FUNCTION public.cleanup_auto_junk_stale_intents(
  p_days_old integer DEFAULT 90,
  p_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_updated int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'cleanup_auto_junk_stale_intents may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  v_cutoff := now() - (LEAST(GREATEST(p_days_old, 1), 365) || ' days')::interval;

  WITH to_junk AS (
    SELECT id
    FROM public.calls
    WHERE status = 'intent'
      AND reviewed_at IS NULL
      AND created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10000)
  )
  UPDATE public.calls
  SET status = 'junk', updated_at = now()
  WHERE id IN (SELECT id FROM to_junk);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.cleanup_auto_junk_stale_intents(integer, integer) IS
  'Break-glass: junk intent rows with no human review older than p_days_old (default 90). service_role only.';
