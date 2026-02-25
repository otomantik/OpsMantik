-- =============================================================================
-- Sprint 1.6 — Iron Dome Mini-Patch (v2: fixed reserved keyword + ENUM cast)
-- Purpose : Enum safety, idempotency, exponential-backoff retry, SKIP LOCKED worker RPC.
-- Backwards-compatible: existing rows are preserved; new columns have safe defaults.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) ENUM: google_action_type
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.google_action_type AS ENUM ('SEND', 'RESTATE', 'RETRACT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2) New columns on conversions
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversions
  ADD COLUMN IF NOT EXISTS intent_id     uuid,
  ADD COLUMN IF NOT EXISTS retry_count   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS google_value  numeric,
  ADD COLUMN IF NOT EXISTS claimed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by    text;

-- ---------------------------------------------------------------------------
-- 3) Convert google_action from text → google_action_type ENUM (safe)
--    Uses text cast via a temporary column to avoid operator issues.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Only attempt if google_action is currently of type text
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'conversions'
      AND column_name  = 'google_action'
      AND udt_name     = 'text'
  ) THEN
    BEGIN
      -- Drop the CHECK constraint first to allow the type change
      ALTER TABLE public.conversions
        DROP CONSTRAINT IF EXISTS conversions_google_action_check;

      ALTER TABLE public.conversions
        ALTER COLUMN google_action
        TYPE public.google_action_type
        USING (CASE
          WHEN google_action IS NULL THEN NULL
          WHEN google_action = 'SEND'    THEN 'SEND'::public.google_action_type
          WHEN google_action = 'RESTATE' THEN 'RESTATE'::public.google_action_type
          WHEN google_action = 'RETRACT' THEN 'RETRACT'::public.google_action_type
          ELSE NULL
        END);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'google_action ENUM conversion skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Backfill google_value from adjustment_value for existing rows
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'conversions'
      AND column_name  = 'adjustment_value'
  ) THEN
    UPDATE public.conversions
       SET google_value = adjustment_value
     WHERE google_value IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Idempotency: same intent processed at most once
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversions_intent_id
  ON public.conversions (intent_id)
  WHERE intent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6) Worker pending index
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_conversions_pending;   -- replace Sprint 1.5 index
CREATE INDEX IF NOT EXISTS idx_conversions_pending_worker
  ON public.conversions (next_retry_at, created_at)
  WHERE google_sent_at IS NULL AND google_action IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7) Claim recovery index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversions_claimed_at
  ON public.conversions (claimed_at)
  WHERE google_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8) RPC: get_pending_conversions_for_worker (SKIP LOCKED + atomic claim)
--    NOTE: deliberately avoids PostgreSQL reserved words as param names.
--    p_current_time replaces current_time (reserved); p_batch_size / p_worker_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_conversions_for_worker(
  p_batch_size   integer,
  p_current_time timestamptz DEFAULT now(),
  p_worker_id    text        DEFAULT 'worker'
)
RETURNS SETOF public.conversions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.conversions
    WHERE google_sent_at  IS NULL
      AND google_action   IS NOT NULL
      AND next_retry_at   <= p_current_time
      AND (
        claimed_at IS NULL
        OR claimed_at < (p_current_time - INTERVAL '10 minutes')
      )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.conversions c
     SET claimed_at  = p_current_time,
         claimed_by  = p_worker_id,
         updated_at  = p_current_time
    FROM picked
   WHERE c.id = picked.id
  RETURNING c.*;
END;
$$;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION public.get_pending_conversions_for_worker(integer, timestamptz, text)
  TO service_role;

COMMIT;
