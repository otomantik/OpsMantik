-- Attribution Truth Engine: append-only shadow ledger for evidence capture (Phase 1).
-- Writes are gated in app code by TRUTH_SHADOW_WRITE_ENABLED; no read-path usage yet.

CREATE TABLE IF NOT EXISTS public.truth_evidence_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'SYNC_EVENT_PROCESSED',
    'CALL_EVENT_CALL_INSERTED'
  )),
  ingest_source text NOT NULL CHECK (ingest_source IN ('SYNC', 'CALL_EVENT')),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid,
  call_id uuid,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  schema_version text NOT NULL DEFAULT 'phase1'
);

COMMENT ON TABLE public.truth_evidence_ledger IS
  'Append-only shadow evidence for truth-engine refactor; PII must not appear in payload (use booleans + ids).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_truth_evidence_ledger_idempotency
  ON public.truth_evidence_ledger (site_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_truth_evidence_ledger_site_ingested
  ON public.truth_evidence_ledger (site_id, ingested_at DESC);

ALTER TABLE public.truth_evidence_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "truth_evidence_ledger_service_role"
  ON public.truth_evidence_ledger FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.truth_evidence_ledger TO service_role;
