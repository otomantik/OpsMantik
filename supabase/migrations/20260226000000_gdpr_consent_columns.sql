-- =============================================================================
-- GDPR Compliance: consent_at, consent_scopes (sessions, events)
-- analytics scope: session/event yazımı için gerekli
-- marketing scope: OCI enqueue için gerekli
-- =============================================================================

BEGIN;

-- sessions: consent columns (partitioned table - columns propagate to partitions)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_scopes text[] DEFAULT '{}';

COMMENT ON COLUMN public.sessions.consent_at IS 'KVKK/GDPR: Rıza alındığı zaman.';
COMMENT ON COLUMN public.sessions.consent_scopes IS 'KVKK/GDPR: İzin kapsamları. analytics=sessions/events yazımı, marketing=OCI enqueue.';

-- events: consent columns (events inherit from session; optional denormalization)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_scopes text[] DEFAULT '{}';

COMMENT ON COLUMN public.events.consent_at IS 'KVKK/GDPR: Session''dan kopyalanır veya event bazlı.';
COMMENT ON COLUMN public.events.consent_scopes IS 'KVKK/GDPR: İzin kapsamları.';

COMMIT;
