-- Operator-Verified Caller Phone Identity
-- Adds caller_phone_raw, caller_phone_e164, caller_phone_hash_sha256 to calls.
-- phone_number stays as clicked target (attribution); caller_phone_* = operator-verified identity.
-- DIC/EC: raw_phone_string = COALESCE(caller_phone_e164, phone_number); hash format: lowercase hex, 64 chars.

BEGIN;

-- 1) Add caller_phone identity columns
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS caller_phone_raw TEXT,
  ADD COLUMN IF NOT EXISTS caller_phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS caller_phone_hash_sha256 TEXT;

COMMENT ON COLUMN public.calls.caller_phone_raw IS 'Operator-entered verbatim phone (audit trail). PII.';
COMMENT ON COLUMN public.calls.caller_phone_e164 IS 'E.164 normalized identity. DIC/EC fallback when set.';
COMMENT ON COLUMN public.calls.caller_phone_hash_sha256 IS 'SHA256(salt+digits) lowercase hex, 64 chars. For EC upload.';

-- 2) Partial index for identity lookup
CREATE INDEX IF NOT EXISTS idx_calls_caller_phone_e164
  ON public.calls (caller_phone_e164)
  WHERE caller_phone_e164 IS NOT NULL;

-- 3) Trigger: block direct UPDATE to caller_phone_* unless session flag set (Least Privilege)
-- Only checks caller_phone_raw, caller_phone_e164, caller_phone_hash_sha256.
-- Other columns (sale_amount, lead_score, etc.) are unaffected.
CREATE OR REPLACE FUNCTION public.check_caller_phone_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role (scripts, admin) can update any column
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

COMMENT ON FUNCTION public.check_caller_phone_update() IS
  'Blocks caller_phone_* updates unless app.allow_caller_phone=1 (set by RPC before seal UPDATE).';

DROP TRIGGER IF EXISTS trg_check_caller_phone_update ON public.calls;
CREATE TRIGGER trg_check_caller_phone_update
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.check_caller_phone_update();

COMMIT;
