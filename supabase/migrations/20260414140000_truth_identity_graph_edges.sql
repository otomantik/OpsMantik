-- Phase 5 (shadow): structural identity edges — fingerprint digest → session (no raw fingerprint stored).

CREATE TABLE IF NOT EXISTS public.truth_identity_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  edge_kind text NOT NULL CHECK (edge_kind IN (
    'FINGERPRINT_SESSION_BRIDGE',
    'SYNC_SESSION_RESOLVED'
  )),
  ingest_source text NOT NULL CHECK (ingest_source IN ('CALL_EVENT_V2', 'SYNC_WORKER')),
  fingerprint_digest text NOT NULL,
  session_id uuid,
  call_id uuid,
  correlation_id text,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.truth_identity_graph_edges IS
  'Shadow identity graph: sha256(fingerprint) → session_id; no raw fingerprint or PII.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_truth_identity_graph_idempotency
  ON public.truth_identity_graph_edges (site_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_truth_identity_graph_site_created
  ON public.truth_identity_graph_edges (site_id, created_at DESC);

ALTER TABLE public.truth_identity_graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "truth_identity_graph_edges_service_role"
  ON public.truth_identity_graph_edges FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT ALL ON public.truth_identity_graph_edges TO service_role;
