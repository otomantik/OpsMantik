-- Idempotent safety net: panel (SKOR TEYİDİ) + OCI upper-funnel writes.
-- Covers DBs that drifted or missed earlier ordered migrations.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS patterns.

BEGIN;

-- ── public.calls: RPC + UI expect these columns (apply_call_action_v2 family) ─────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.calls.metadata IS
  'Audit JSON merged by apply_call_action_v2 (stage, actor_id, sale_metadata, client p_metadata).';

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS caller_phone_raw text,
  ADD COLUMN IF NOT EXISTS caller_phone_e164 text,
  ADD COLUMN IF NOT EXISTS caller_phone_hash_sha256 text,
  ADD COLUMN IF NOT EXISTS phone_source_type text;

COMMENT ON COLUMN public.calls.caller_phone_raw IS
  'Operator-entered verbatim phone (audit / PII). Written only via guarded RPC.';
COMMENT ON COLUMN public.calls.caller_phone_e164 IS
  'E.164 normalized phone when operator verified.';
COMMENT ON COLUMN public.calls.caller_phone_hash_sha256 IS
  'SHA256(salt+digits) lowercase hex (64). Offline conversion user_identifier.';
COMMENT ON COLUMN public.calls.phone_source_type IS
  'Phone capture provenance; apply_call_action_v2 sets operator_verified when phone payload present.';

CREATE OR REPLACE FUNCTION public.check_caller_phone_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF (NEW.caller_phone_raw IS DISTINCT FROM OLD.caller_phone_raw
      OR NEW.caller_phone_e164 IS DISTINCT FROM OLD.caller_phone_e164
      OR NEW.caller_phone_hash_sha256 IS DISTINCT FROM OLD.caller_phone_hash_sha256)
     AND current_setting('app.allow_caller_phone', true) IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION 'Direct update to caller_phone columns is restricted.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_caller_phone_update ON public.calls;
CREATE TRIGGER trg_check_caller_phone_update
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.check_caller_phone_update();

CREATE INDEX IF NOT EXISTS idx_calls_caller_phone_e164
  ON public.calls (caller_phone_e164)
  WHERE caller_phone_e164 IS NOT NULL;

-- Legacy calls_status_check excluded panel stages → updates to contacted/offered/won failed silently or with check violation.
UPDATE public.calls
SET status = 'intent'
WHERE status IS NOT NULL AND btrim(status) = '';

ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;

ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
  status IS NULL
  OR status = ANY (
    ARRAY[
      'intent',
      'contacted',
      'offered',
      'won',
      'confirmed',
      'junk',
      'cancelled',
      'qualified',
      'real',
      'suspicious'
    ]::text[]
  )
);

COMMENT ON CONSTRAINT calls_status_check ON public.calls IS
  'Panel + OCI funnel statuses (incl. contacted, offered, won) and legacy qualified/real/suspicious API.';

-- ── public.marketing_signals: SSOT economics columns (upsertMarketingSignal) ─────────
DO $$
BEGIN
  IF to_regclass('public.marketing_signals') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.marketing_signals
    ADD COLUMN IF NOT EXISTS currency_code text,
    ADD COLUMN IF NOT EXISTS value_source text,
    ADD COLUMN IF NOT EXISTS conversion_time_source text;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketing_signals'
      AND column_name = 'value_cents'
  ) THEN
    ALTER TABLE public.marketing_signals
      ADD COLUMN value_cents bigint
      GENERATED ALWAYS AS (COALESCE(expected_value_cents, 0::bigint)) STORED;
  END IF;

  ALTER TABLE public.marketing_signals
    ALTER COLUMN google_conversion_time DROP DEFAULT;
END $$;

COMMIT;
