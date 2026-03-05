-- =============================================================================
-- OCI Phase 11 — Mutation 1: Bitemporal Marketing Signals Ledger
-- =============================================================================
-- Adds sys_period (system time) and valid_period (business event time) to
-- marketing_signals table. Enables time-travel queries for Google Ads audits.
--
-- Query pattern (time-travel):
--   WHERE sys_period @> $asOf::timestamptz
--   AND valid_period @> $businessEventTs::timestamptz
-- =============================================================================

BEGIN;

-- GiST composite (site_id, sys_period) requires btree_gist for uuid
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 1: Add bitemporal columns
ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS sys_period    tstzrange
    NOT NULL
    DEFAULT tstzrange(now(), 'infinity', '[)'),
  ADD COLUMN IF NOT EXISTS valid_period  tstzrange
    NOT NULL
    DEFAULT tstzrange(now(), 'infinity', '[)');

-- Step 2: Backfill existing rows from existing timestamps
-- sys_period and valid_period: both use created_at to avoid casting empty/invalid google_conversion_time (SQLSTATE 22007).
-- New rows will have valid_period set from application logic using google_conversion_time when present.
UPDATE public.marketing_signals
SET
  sys_period   = tstzrange(
    COALESCE(created_at, now()),
    'infinity',
    '[)'
  ),
  valid_period = tstzrange(
    COALESCE(created_at, now()),
    'infinity',
    '[)'
  )
WHERE sys_period = tstzrange(now(), 'infinity', '[)');  -- only affects rows with default

-- Step 3: GiST indexes for time-range queries (O(log n) for @>, &&, <@)
CREATE INDEX IF NOT EXISTS idx_marketing_signals_sys_period
  ON public.marketing_signals USING gist (sys_period);

CREATE INDEX IF NOT EXISTS idx_marketing_signals_valid_period
  ON public.marketing_signals USING gist (valid_period);

-- Composite index for the most common query pattern: site + sys time
CREATE INDEX IF NOT EXISTS idx_marketing_signals_site_sys_period
  ON public.marketing_signals USING gist (site_id, sys_period);

-- Step 4: History table for closed periods (when signals are adjusted)
-- Stores old rows before any UPDATE that changes the value
CREATE TABLE IF NOT EXISTS public.marketing_signals_history (
  LIKE public.marketing_signals INCLUDING DEFAULTS,
  history_recorded_at timestamptz NOT NULL DEFAULT now(),
  history_action      text        NOT NULL DEFAULT 'UPDATE'
);

CREATE INDEX IF NOT EXISTS idx_ms_history_call_id
  ON public.marketing_signals_history (call_id, history_recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ms_history_site_sys
  ON public.marketing_signals_history USING gist (site_id, sys_period);

-- Step 5: Trigger to write old version to history before update
CREATE OR REPLACE FUNCTION public.marketing_signals_bitemporal_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Close the sys_period of the OLD row (reality: system stopped believing this at NOW)
  OLD.sys_period := tstzrange(lower(OLD.sys_period), now(), '[)');
  
  -- Insert the closed old version into history
  INSERT INTO public.marketing_signals_history VALUES (OLD.*, now(), 'UPDATE');
  
  -- Open the new sys_period starting now
  NEW.sys_period := tstzrange(now(), 'infinity', '[)');
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_signals_bitemporal ON public.marketing_signals;
CREATE TRIGGER trg_marketing_signals_bitemporal
  BEFORE UPDATE ON public.marketing_signals
  FOR EACH ROW
  WHEN (
    OLD.conversion_value IS DISTINCT FROM NEW.conversion_value
    OR OLD.expected_value_cents IS DISTINCT FROM NEW.expected_value_cents
    OR OLD.dispatch_status IS DISTINCT FROM NEW.dispatch_status
  )
  EXECUTE FUNCTION public.marketing_signals_bitemporal_audit();

-- Step 6: Helper RPC for time-travel export
CREATE OR REPLACE FUNCTION public.get_marketing_signals_as_of(
  p_site_id uuid,
  p_as_of   timestamptz DEFAULT now()
)
RETURNS TABLE (
  id                      uuid,
  call_id                 uuid,
  site_id                 uuid,
  signal_type             text,
  google_conversion_name  text,
  google_conversion_time  text,
  conversion_value        numeric,
  gclid                   text,
  wbraid                  text,
  gbraid                  text,
  dispatch_status         text,
  expected_value_cents    bigint,
  sys_period              tstzrange,
  valid_period            tstzrange
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  -- Return the row that was CURRENT in the system at p_as_of
  -- Uses history table for past states, live table for current state
  (
    SELECT
      ms.id, ms.call_id, ms.site_id, ms.signal_type,
      ms.google_conversion_name, ms.google_conversion_time,
      ms.conversion_value, ms.gclid, ms.wbraid, ms.gbraid,
      ms.dispatch_status, ms.expected_value_cents,
      ms.sys_period, ms.valid_period
    FROM public.marketing_signals ms
    WHERE ms.site_id = p_site_id
      AND ms.sys_period @> p_as_of
  )
  UNION ALL
  (
    SELECT
      h.id, h.call_id, h.site_id, h.signal_type,
      h.google_conversion_name, h.google_conversion_time,
      h.conversion_value, h.gclid, h.wbraid, h.gbraid,
      h.dispatch_status, h.expected_value_cents,
      h.sys_period, h.valid_period
    FROM public.marketing_signals_history h
    WHERE h.site_id = p_site_id
      AND h.sys_period @> p_as_of
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_marketing_signals_as_of(uuid, timestamptz)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_marketing_signals_as_of IS
  'Bitemporal time-travel: returns marketing_signals as the system believed them at p_as_of. Uses live table for current, history table for past.';

COMMIT;
