-- Sprint 1.5: Conversions table + Google Conversion Action dispatcher schema.
-- Tracks conversion outcomes and their dispatch state to the Google Ads API.
-- Worker polls WHERE google_sent_at IS NULL to find pending records.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) conversions table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Attribution context
  gclid               text,
  session_id          uuid,
  visitor_id          uuid,

  -- Conversion signal
  star                integer     CHECK (star BETWEEN 1 AND 5),
  revenue             numeric     DEFAULT 0,
  presignal_value     numeric     DEFAULT 0,

  -- Google dispatch state
  google_action       text        CHECK (google_action IN ('SEND', 'RESTATE', 'RETRACT')),
  adjustment_value    numeric     DEFAULT 0,

  -- Worker tracking
  google_sent_at      timestamptz,
  google_response     jsonb,

  -- Timestamps
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2) Partial index for worker efficiency: only scans pending rows
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversions_pending
  ON public.conversions (google_action)
  WHERE google_sent_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3) Index for dedup / lookup by gclid
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_conversions_gclid
  ON public.conversions (gclid);

-- -----------------------------------------------------------------------------
-- 4) updated_at auto-bump trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._conversions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER conversions_set_updated_at
  BEFORE UPDATE ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public._conversions_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5) RLS: service_role full access; authenticated users read own records
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversions_service_role_all"
  ON public.conversions
  USING ((auth.jwt() ->> 'role') = 'service_role');

COMMIT;
