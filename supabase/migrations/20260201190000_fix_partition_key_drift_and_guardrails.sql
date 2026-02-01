-- =============================================================================
-- FIX: Partition key drift (sessions.created_month / events.session_month)
-- Why:
--  - sessions.created_month defaults to CURRENT_DATE -> can drift from created_at (UTC)
--  - events.session_month can drift from the session's month -> breaks FK + joins -> "today empty"
--
-- What this migration does:
--  1) Makes fk_events_session DEFERRABLE so we can repair keys safely in one transaction
--  2) Backfills: align sessions.created_month to created_at month (UTC) and events.session_month to session month
--     - Uses INSERT+DELETE for events (safe across partitions)
--  3) Adds triggers to prevent drift going forward
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Make FK deferrable (so coordinated repairs are possible)
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
-- 2) Backfill: repair existing drift (safe + idempotent)
-- -----------------------------------------------------------------------------
BEGIN;

-- Ensure the FK is deferred inside this transaction (defensive; should already be INITIALLY DEFERRED)
SET CONSTRAINTS fk_events_session DEFERRED;

-- 2.1 Fix sessions.created_month based on created_at month in UTC.
-- NOTE: Updating the partition key will move rows between partitions as needed.
UPDATE public.sessions s
SET created_month = date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date
WHERE s.created_month <> date_trunc('month', (s.created_at AT TIME ZONE 'utc'))::date;

-- 2.2 Backfill events.site_id from session (fast path for realtime filters).
-- Safe even if already populated.
UPDATE public.events e
SET site_id = s.site_id
FROM public.sessions s
WHERE s.id = e.session_id
  AND e.site_id IS NULL;

-- 2.3 Copy mismatched events into the correct partition (session_month = sessions.created_month),
-- then delete the old mismatched rows.
INSERT INTO public.events (
  id,
  session_id,
  session_month,
  url,
  created_at,
  event_category,
  event_action,
  event_label,
  event_value,
  metadata,
  site_id,
  ingest_dedup_id
)
SELECT
  e.id,
  e.session_id,
  s.created_month AS session_month,
  e.url,
  e.created_at,
  e.event_category,
  e.event_action,
  e.event_label,
  e.event_value,
  e.metadata,
  COALESCE(e.site_id, s.site_id) AS site_id,
  e.ingest_dedup_id
FROM public.events e
JOIN public.sessions s
  ON s.id = e.session_id
WHERE e.session_month <> s.created_month
ON CONFLICT (id, session_month) DO NOTHING;

DELETE FROM public.events e
USING public.sessions s
WHERE s.id = e.session_id
  AND e.session_month <> s.created_month;

COMMIT;

-- -----------------------------------------------------------------------------
-- 3) Guardrails: triggers to prevent future drift
-- -----------------------------------------------------------------------------

-- 3.1 Sessions: always compute created_month from created_at (UTC)
CREATE OR REPLACE FUNCTION public.trg_sessions_set_created_month()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;

  NEW.created_month := date_trunc('month', (NEW.created_at AT TIME ZONE 'utc'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_set_created_month ON public.sessions;
CREATE TRIGGER sessions_set_created_month
BEFORE INSERT OR UPDATE OF created_at ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.trg_sessions_set_created_month();

COMMENT ON FUNCTION public.trg_sessions_set_created_month() IS
  'Ensures sessions.created_month always equals date_trunc(month, created_at UTC)::date (prevents partition drift).';

-- 3.2 Events: always compute session_month (and optional site_id) from the referenced session
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

  SELECT s.created_month, s.site_id
    INTO v_month, v_site
  FROM public.sessions s
  WHERE s.id = NEW.session_id
  LIMIT 1;

  IF v_month IS NULL THEN
    RAISE EXCEPTION 'Session % not found for event insert/update', NEW.session_id;
  END IF;

  NEW.session_month := v_month;
  IF NEW.site_id IS NULL THEN
    NEW.site_id := v_site;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_set_session_month_from_session ON public.events;
CREATE TRIGGER events_set_session_month_from_session
BEFORE INSERT OR UPDATE OF session_id, session_month, site_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.trg_events_set_session_month_from_session();

COMMENT ON FUNCTION public.trg_events_set_session_month_from_session() IS
  'Forces events.session_month to match the referenced session''s created_month (and fills site_id if NULL).';

