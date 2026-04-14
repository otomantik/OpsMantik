-- PR3: append-only canonical truth substrate (shadow writes only; gated by TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED in app).

CREATE TABLE IF NOT EXISTS public.truth_canonical_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  stream_kind text NOT NULL CHECK (stream_kind IN (
    'INGEST_SYNC',
    'INGEST_CALL_EVENT',
    'FUNNEL_LEDGER'
  )),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid,
  call_id uuid,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  schema_version text NOT NULL DEFAULT 'canonical_v1'
);

COMMENT ON TABLE public.truth_canonical_ledger IS
  'Append-only canonical truth substrate (PR3 shadow); payload must follow canonical contract — no raw PII or provider metadata dumps.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_truth_canonical_ledger_idempotency
  ON public.truth_canonical_ledger (site_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_truth_canonical_ledger_site_ingested
  ON public.truth_canonical_ledger (site_id, ingested_at DESC);

ALTER TABLE public.truth_canonical_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "truth_canonical_ledger_service_role"
  ON public.truth_canonical_ledger FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.truth_canonical_ledger TO service_role;
