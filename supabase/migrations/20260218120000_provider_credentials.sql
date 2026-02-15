-- =============================================================================
-- PR-G1: provider_credentials — secure storage for ad provider credentials (vault).
-- Encrypted payload with RLS: authenticated can INSERT/UPDATE with site access;
-- service_role required to read encrypted_payload for server-side decrypt.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  encrypted_payload text NOT NULL,
  key_fingerprint text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, provider_key)
);

COMMENT ON TABLE public.provider_credentials IS
  'Encrypted ad provider credentials per site. encrypted_payload is sealed-box ciphertext; only server with OPSMANTIK_VAULT_KEY can decrypt.';

CREATE INDEX IF NOT EXISTS idx_provider_credentials_site_provider
  ON public.provider_credentials (site_id, provider_key)
  WHERE is_active = true;

ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;

-- Authenticated: INSERT only if user has site access (owner, member, or admin).
CREATE POLICY provider_credentials_insert_policy ON public.provider_credentials
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_access_site(auth.uid(), site_id));

-- Authenticated: UPDATE only if user has site access.
CREATE POLICY provider_credentials_update_policy ON public.provider_credentials
  FOR UPDATE
  TO authenticated
  USING (public.can_access_site(auth.uid(), site_id))
  WITH CHECK (public.can_access_site(auth.uid(), site_id));

-- Authenticated: SELECT allowed for site access (for listing/metadata); API must never return encrypted_payload to client.
CREATE POLICY provider_credentials_select_policy ON public.provider_credentials
  FOR SELECT
  TO authenticated
  USING (public.can_access_site(auth.uid(), site_id));

-- service_role can do everything (bypasses RLS by default; used by worker to decrypt).
-- No separate policy needed; RLS does not apply to service_role when using service key.

COMMIT;
