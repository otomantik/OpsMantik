-- DIC (Deterministic Identity-to-Conversion) / Deep-Attribution schema
-- user_agent on calls and sessions, default_country_iso on sites, phone_source_type on calls

BEGIN;

-- sessions: user_agent (for DIC attribution forensic touchpoint chain)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS user_agent text;

-- calls: user_agent (raw UA at conversion for ECL / device entropy)
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS user_agent text;

COMMENT ON COLUMN public.calls.user_agent IS 'DIC: Raw user-agent at call/conversion time. Used for device entropy and gbraid vs phone-hash prioritization.';

-- calls: phone_source_type (Form-Fill | Click-to-Call | Manual Dial for Trust Score)
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS phone_source_type text;

COMMENT ON COLUMN public.calls.phone_source_type IS 'DIC: How phone was captured: form_fill, click_to_call, manual_dial. Affects identity Trust Score. Derived from intent_action/intent_target if not set.';

-- sites: default_country_iso for E.164 normalization context
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS default_country_iso text DEFAULT 'TR';

COMMENT ON COLUMN public.sites.default_country_iso IS 'DIC: Default country ISO (e.g. TR, US) for E.164 phone normalization and Enhanced Conversions.';

COMMIT;
