-- Restore UNIQUE constraint for ensure_session_intent_v1 ON CONFLICT
--
-- ensure_session_intent_v1 uses ON CONFLICT (site_id, intent_stamp). PostgreSQL
-- requires a non-partial UNIQUE constraint for this; the partial index
-- idx_calls_site_intent_stamp_uniq (WHERE intent_stamp IS NOT NULL) is NOT
-- inferred by ON CONFLICT. 20260128039000 dropped the full constraint; this
-- restores it so intent inserts succeed. UNIQUE allows multiple NULLs.
--
-- See: ERROR 42P10 "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification"

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calls_site_intent_stamp_uniq'
      AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_site_intent_stamp_uniq
      UNIQUE (site_id, intent_stamp);
  END IF;
END $$;

COMMIT;
