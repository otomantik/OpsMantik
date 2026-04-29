BEGIN;

-- Hard production invariant:
-- one active click intent card per (site_id, matched_session_id).
-- This closes race windows where app-level idempotency can drift.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_active_click_single_card_per_session
  ON public.calls(site_id, matched_session_id)
  WHERE source = 'click'
    AND matched_session_id IS NOT NULL
    AND (merged_into_call_id IS NULL)
    AND lower(coalesce(status, 'intent')) IN ('intent', 'contacted', 'offered', 'won', 'confirmed');

-- Secondary guard for diagnostics and forensic queries.
CREATE INDEX IF NOT EXISTS idx_calls_active_click_session_fingerprint
  ON public.calls(site_id, matched_session_id, matched_fingerprint)
  WHERE source = 'click'
    AND matched_session_id IS NOT NULL
    AND (merged_into_call_id IS NULL)
    AND lower(coalesce(status, 'intent')) IN ('intent', 'contacted', 'offered', 'won', 'confirmed');

COMMIT;
