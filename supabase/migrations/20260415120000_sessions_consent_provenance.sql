-- PR2: optional CMP/consent metadata for shadow verification (no enforcement in PR2).

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS consent_provenance jsonb NULL;

COMMENT ON COLUMN public.sessions.consent_provenance IS
  'Optional consent provenance (source, policy_version). Null = legacy or never set via gdpr/consent API.';
