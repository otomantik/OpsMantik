BEGIN;

-- Conversion Value Policy Guardrails (v1)
-- Scope: protect new/updated value-policy writes without breaking normal status transitions.

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS value_source text,
  ADD COLUMN IF NOT EXISTS value_policy_version text,
  ADD COLUMN IF NOT EXISTS value_policy_reason text,
  ADD COLUMN IF NOT EXISTS value_fallback_used boolean,
  ADD COLUMN IF NOT EXISTS value_repair_reason text,
  ADD COLUMN IF NOT EXISTS value_repaired_at timestamptz,
  ADD COLUMN IF NOT EXISTS value_repaired_by text;

ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS value_policy_version text,
  ADD COLUMN IF NOT EXISTS value_policy_reason text,
  ADD COLUMN IF NOT EXISTS value_fallback_used boolean,
  ADD COLUMN IF NOT EXISTS value_repair_reason text,
  ADD COLUMN IF NOT EXISTS value_repaired_at timestamptz,
  ADD COLUMN IF NOT EXISTS value_repaired_by text;

CREATE OR REPLACE FUNCTION public.validate_conversion_value_policy_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sqlstate text := 'P0001';
BEGIN
  -- Queue guardrails: only Won conversion rows are policy-validated here.
  IF TG_TABLE_NAME = 'offline_conversion_queue' THEN
    IF NEW.action = 'OpsMantik_Won' THEN
      IF NEW.value_cents IS NULL OR NEW.value_cents <= 0 THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_value_cents_required_positive';
      END IF;

      IF NEW.value_cents < 6000 OR NEW.value_cents > 12000 THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_value_cents_out_of_range_6000_12000';
      END IF;

      IF COALESCE(NEW.value_policy_version, '') = '' THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:queue_policy_version_required';
      END IF;

      IF COALESCE(NEW.value_source, '') = '' THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:queue_value_source_required';
      END IF;

      IF NEW.actual_revenue IS NOT NULL AND NEW.actual_revenue > 0 THEN
        IF COALESCE(NEW.value_fallback_used, false) = true THEN
          RAISE EXCEPTION USING
            ERRCODE = v_sqlstate,
            MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_actual_revenue_present_fallback_must_be_false';
        END IF;
      ELSIF COALESCE(NEW.value_fallback_used, false) = false THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_actual_revenue_missing_fallback_must_be_true';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- marketing_signals guardrails by conversion name.
  IF TG_TABLE_NAME = 'marketing_signals' THEN
    IF NEW.google_conversion_name IN ('OpsMantik_Contacted', 'OpsMantik_Offered', 'OpsMantik_Junk_Exclusion', 'OpsMantik_Won') THEN
      IF NEW.expected_value_cents IS NULL OR NEW.expected_value_cents <= 0 THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:signals_expected_value_cents_required_positive';
      END IF;

      IF COALESCE(NEW.value_policy_version, '') = '' THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:signals_policy_version_required';
      END IF;

      IF COALESCE(NEW.value_source, '') = '' THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:signals_value_source_required';
      END IF;

      IF NEW.google_conversion_name = 'OpsMantik_Contacted' AND (NEW.expected_value_cents < 600 OR NEW.expected_value_cents > 1200) THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:contacted_expected_value_cents_out_of_range_600_1200';
      ELSIF NEW.google_conversion_name = 'OpsMantik_Offered' AND (NEW.expected_value_cents < 3000 OR NEW.expected_value_cents > 6000) THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:offered_expected_value_cents_out_of_range_3000_6000';
      ELSIF NEW.google_conversion_name = 'OpsMantik_Won' AND (NEW.expected_value_cents < 6000 OR NEW.expected_value_cents > 12000) THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:won_expected_value_cents_out_of_range_6000_12000';
      ELSIF NEW.google_conversion_name = 'OpsMantik_Junk_Exclusion' AND NEW.expected_value_cents <> 10 THEN
        RAISE EXCEPTION USING
          ERRCODE = v_sqlstate,
          MESSAGE = 'OCI_VALUE_POLICY_V1_VIOLATION:junk_expected_value_cents_must_equal_10';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_conversion_value_policy_v1_queue ON public.offline_conversion_queue;
CREATE TRIGGER trg_validate_conversion_value_policy_v1_queue
BEFORE INSERT OR UPDATE OF action, value_cents, value_source, value_policy_version, value_fallback_used, actual_revenue
ON public.offline_conversion_queue
FOR EACH ROW
EXECUTE FUNCTION public.validate_conversion_value_policy_v1();

DROP TRIGGER IF EXISTS trg_validate_conversion_value_policy_v1_signals ON public.marketing_signals;
CREATE TRIGGER trg_validate_conversion_value_policy_v1_signals
BEFORE INSERT OR UPDATE OF google_conversion_name, expected_value_cents, value_source, value_policy_version
ON public.marketing_signals
FOR EACH ROW
EXECUTE FUNCTION public.validate_conversion_value_policy_v1();

COMMENT ON FUNCTION public.validate_conversion_value_policy_v1()
IS 'PR-D guardrails: validates conversion value policy v1 for queue/signals writes only; does not target status transitions.';

COMMIT;
