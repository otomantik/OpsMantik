-- apply_call_action_v2 (+ intents views/RPCs) SELECT/UPDATE caller_phone_* and phone_source_type.
-- Missing columns ⇒ "column c.caller_phone_raw does not exist" on panel / seal / SKOR TEYİDİ.

BEGIN;

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

COMMIT;
