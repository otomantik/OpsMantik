-- Call-Event DB Idempotency (Model B)
-- Adds signature_hash to calls; UNIQUE(site_id, signature_hash) enforces idempotency when Redis is down.
-- Existing rows keep signature_hash NULL (no backfill this sprint).
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction; Supabase runs migrations in a transaction.
-- If index creation blocks for large calls table, use OPTIONAL_20260228000000_call_event_signature_hash_concurrent.sql.

BEGIN;
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS signature_hash text;

COMMENT ON COLUMN public.calls.signature_hash IS
  'DB idempotency: sha256(x-ops-signature). Same signature → same hash → UNIQUE prevents duplicate insert when Redis replay cache is down.';

CREATE UNIQUE INDEX IF NOT EXISTS calls_site_signature_hash_uq
  ON public.calls (site_id, signature_hash)
  WHERE signature_hash IS NOT NULL;

COMMENT ON INDEX public.calls_site_signature_hash_uq IS
  'Call-event DB idempotency: prevents duplicate inserts when Redis replay cache unavailable (multi-instance).';

COMMIT;
