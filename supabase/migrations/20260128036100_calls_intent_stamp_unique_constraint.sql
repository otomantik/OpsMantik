-- Migration: Phase 1 Stamp Package — ON CONFLICT compatibility
-- Date: 2026-01-28
--
-- PostgREST/Supabase upsert (on_conflict) requires a UNIQUE constraint or a
-- non-partial UNIQUE index for inference. A partial unique index
-- (WHERE intent_stamp IS NOT NULL) is not inferred by ON CONFLICT (cols).
--
-- This constraint preserves the same behavior because UNIQUE allows multiple NULLs.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calls_site_intent_stamp_uniq'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_site_intent_stamp_uniq
      UNIQUE (site_id, intent_stamp);
  END IF;
END $$;

COMMIT;

