-- Conversion Truth OS P0: shadow ledger for Source Truth Engine v2 (legacy columns unchanged).

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS traffic_v2_ledger jsonb;

COMMENT ON COLUMN public.sessions.traffic_v2_ledger IS
  'Source Truth Engine v2 investigation ledger (shadow mode). Canonical channel, evidence, decision_trace.';

CREATE INDEX IF NOT EXISTS idx_sessions_site_fingerprint_created_at
  ON public.sessions (site_id, fingerprint, created_at DESC)
  WHERE fingerprint IS NOT NULL;
