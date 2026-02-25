-- =============================================================================
-- Scoring Brain V1.1: calls.confidence_score + call_scores audit table
-- Backward compatible: existing calls/score_breakdown unchanged. No backfill.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A1) calls.confidence_score
-- -----------------------------------------------------------------------------
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS confidence_score integer NULL;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_confidence_score_range;

ALTER TABLE public.calls
  ADD CONSTRAINT calls_confidence_score_range
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));

COMMENT ON COLUMN public.calls.confidence_score IS
  'V1.1 linear confidence 0–100; NULL = legacy/not computed.';

-- -----------------------------------------------------------------------------
-- A2) call_scores (audit trail)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  score_version text NOT NULL DEFAULT 'v1.1',
  quality_score int NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
  confidence_score int NULL CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  conversion_points int NOT NULL,
  interaction_points int NOT NULL,
  bonuses int NOT NULL,
  bonuses_capped int NOT NULL,
  penalties int NOT NULL DEFAULT 0,
  raw_score int NOT NULL,
  capped_at_100 boolean NOT NULL,
  inputs_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id)
);

COMMENT ON TABLE public.call_scores IS
  'V1.1 scoring audit: one row per call with full breakdown and inputs_snapshot for 6-month audit.';

CREATE INDEX IF NOT EXISTS idx_call_scores_site_created
  ON public.call_scores (site_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS: call_scores
-- -----------------------------------------------------------------------------
ALTER TABLE public.call_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_scores_select_via_site" ON public.call_scores;
CREATE POLICY "call_scores_select_via_site"
  ON public.call_scores FOR SELECT
  TO authenticated
  USING (
    public.can_access_site(auth.uid(), site_id)
  );

-- No INSERT/UPDATE/DELETE for authenticated; only service_role can write.

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.call_scores TO authenticated;
GRANT INSERT, UPDATE, SELECT ON public.call_scores TO service_role;

COMMIT;
