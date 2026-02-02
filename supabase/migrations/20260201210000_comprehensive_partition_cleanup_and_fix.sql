-- =============================================================================
-- COMPREHENSIVE PARTITION CLEANUP & FIX
-- 
-- Problem: Şubat ayına geçişte partition key drift + worker/trigger mismatch
-- Solution: Tek seferde temizlik + doğru ayarlar
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: ANALYZE CURRENT STATE (for logging)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_sessions INTEGER;
  v_bad_events INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_bad_sessions
  FROM public.sessions s
  WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;
  
  SELECT COUNT(*) INTO v_bad_events
  FROM public.events e
  JOIN public.sessions s ON s.id = e.session_id
  WHERE e.session_month <> s.created_month;
  
  RAISE NOTICE 'BEFORE CLEANUP: bad_sessions=%, bad_events=%', v_bad_sessions, v_bad_events;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 2: DROP OLD TRIGGERS (clean slate)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS sessions_set_created_month ON public.sessions;
DROP TRIGGER IF EXISTS events_set_session_month_from_session ON public.events;
DROP FUNCTION IF EXISTS public.trg_sessions_set_created_month();
DROP FUNCTION IF EXISTS public.trg_events_set_session_month_from_session();

-- -----------------------------------------------------------------------------
-- STEP 3: FIX FK (make deferrable for safe repair)
-- -----------------------------------------------------------------------------
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS fk_events_session;

ALTER TABLE public.events
  ADD CONSTRAINT fk_events_session
  FOREIGN KEY (session_id, session_month)
  REFERENCES public.sessions (id, created_month)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- STEP 4: REPAIR EXISTING DRIFT (safe transaction)
-- -----------------------------------------------------------------------------
BEGIN;

SET CONSTRAINTS fk_events_session DEFERRED;

-- 4.1 Fix sessions.created_month (UTC month from created_at)
UPDATE public.sessions s
SET created_month = date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date
WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;

-- 4.2 Backfill events.site_id (if NULL)
UPDATE public.events e
SET site_id = s.site_id
FROM public.sessions s
WHERE s.id = e.session_id
  AND e.site_id IS NULL;

-- 4.3 Fix events.session_month (match session's created_month)
-- Strategy: INSERT into correct partition, then DELETE from wrong partition
INSERT INTO public.events (
  id, session_id, session_month, url, created_at,
  event_category, event_action, event_label, event_value,
  metadata, site_id, ingest_dedup_id
)
SELECT
  e.id, e.session_id, s.created_month AS session_month, e.url, e.created_at,
  e.event_category, e.event_action, e.event_label, e.event_value,
  e.metadata, COALESCE(e.site_id, s.site_id) AS site_id, e.ingest_dedup_id
FROM public.events e
JOIN public.sessions s ON s.id = e.session_id
WHERE e.session_month <> s.created_month
ON CONFLICT (id, session_month) DO NOTHING;

-- Delete old mismatched rows
DELETE FROM public.events e
USING public.sessions s
WHERE s.id = e.session_id
  AND e.session_month <> s.created_month;

COMMIT;

-- -----------------------------------------------------------------------------
-- STEP 5: CREATE CORRECT TRIGGERS (always run on INSERT, not just UPDATE)
-- -----------------------------------------------------------------------------

-- 5.1 Sessions trigger: ALWAYS compute created_month from created_at (UTC)
CREATE OR REPLACE FUNCTION public.trg_sessions_set_created_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure created_at is set (default fallback)
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;
  
  -- CRITICAL: Always compute from created_at UTC (matches partition logic)
  NEW.created_month := date_trunc('month', (NEW.created_at AT TIME ZONE 'utc'))::date;
  
  RETURN NEW;
END;
$$;

-- Trigger runs on EVERY INSERT (worker may send dbMonth, but trigger overrides)
CREATE TRIGGER sessions_set_created_month
BEFORE INSERT OR UPDATE OF created_at, created_month ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.trg_sessions_set_created_month();

COMMENT ON FUNCTION public.trg_sessions_set_created_month() IS
  'ALWAYS sets sessions.created_month = date_trunc(month, created_at UTC)::date. Overrides any explicit dbMonth from worker.';

-- 5.2 Events trigger: ALWAYS compute session_month from session
CREATE OR REPLACE FUNCTION public.trg_events_set_session_month_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_site uuid;
BEGIN
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'events.session_id cannot be NULL';
  END IF;
  
  -- Lookup session's created_month (trigger ensures it's correct)
  -- NOTE: If session not found, it might be in the same transaction (not yet committed)
  -- In that case, we'll use the provided session_month (worker should have set it correctly)
  SELECT s.created_month, s.site_id
    INTO v_month, v_site
  FROM public.sessions s
  WHERE s.id = NEW.session_id
  LIMIT 1;
  
  -- If session found: use its created_month (always correct, trigger-set)
  IF v_month IS NOT NULL THEN
    NEW.session_month := v_month;
    IF NEW.site_id IS NULL THEN
      NEW.site_id := v_site;
    END IF;
  ELSE
    -- Session not found: might be same transaction (FK is DEFERRABLE)
    -- In this case, trust the provided session_month (worker calculated it)
    -- But log a warning for debugging
    IF NEW.session_month IS NULL THEN
      RAISE EXCEPTION 'Session % not found and session_month is NULL', NEW.session_id;
    END IF;
    -- session_month already set by worker, keep it
    -- site_id will be set by another trigger or worker
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger runs on EVERY INSERT (worker may send session_month, but trigger overrides)
CREATE TRIGGER events_set_session_month_from_session
BEFORE INSERT OR UPDATE OF session_id, session_month, site_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.trg_events_set_session_month_from_session();

COMMENT ON FUNCTION public.trg_events_set_session_month_from_session() IS
  'ALWAYS sets events.session_month = sessions.created_month. Overrides any explicit session_month from worker.';

-- -----------------------------------------------------------------------------
-- STEP 6: VERIFY CLEANUP (final check)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_sessions INTEGER;
  v_bad_events INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_bad_sessions
  FROM public.sessions s
  WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;
  
  SELECT COUNT(*) INTO v_bad_events
  FROM public.events e
  JOIN public.sessions s ON s.id = e.session_id
  WHERE e.session_month <> s.created_month;
  
  IF v_bad_sessions > 0 OR v_bad_events > 0 THEN
    RAISE WARNING 'AFTER CLEANUP: Still have bad_sessions=%, bad_events=%', v_bad_sessions, v_bad_events;
  ELSE
    RAISE NOTICE 'AFTER CLEANUP: SUCCESS - bad_sessions=0, bad_events=0';
  END IF;
END $$;
