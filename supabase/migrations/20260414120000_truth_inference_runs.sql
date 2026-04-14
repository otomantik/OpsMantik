-- Phase 3: append-only inference run registry (shadow; gated by TRUTH_INFERENCE_REGISTRY_ENABLED in app).

CREATE TABLE IF NOT EXISTS public.truth_inference_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  inference_kind text NOT NULL CHECK (inference_kind IN (
    'SYNC_ATTRIBUTION_V1',
    'CALL_EVENT_SESSION_MATCH_V1'
  )),
  policy_version text NOT NULL,
  engine_version text NOT NULL DEFAULT '',
  input_digest text NOT NULL,
  output_summary jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL,
  correlation_id text,
  dedup_event_id uuid,
  session_id uuid,
  call_id uuid,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.truth_inference_runs IS
  'Shadow registry of attribution/session inference decisions; output_summary must not contain raw PII.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_truth_inference_runs_idempotency
  ON public.truth_inference_runs (site_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_truth_inference_runs_site_created
  ON public.truth_inference_runs (site_id, created_at DESC);

ALTER TABLE public.truth_inference_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "truth_inference_runs_service_role"
  ON public.truth_inference_runs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.truth_inference_runs TO service_role;
