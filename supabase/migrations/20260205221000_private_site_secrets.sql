-- Migration: private.site_secrets + signature verification RPC for call-event
-- Date: 2026-02-05
--
-- Goals:
-- - Store per-site HMAC secrets in private schema (not in public tables)
-- - Support rotation via current_secret + next_secret
-- - Provide a SECURITY DEFINER verification RPC callable by anon/authenticated
--   that returns boolean only (secrets never leave DB)
--
-- NOTE:
-- - `private.get_site_secrets()` is service-role only (admin tooling).
-- - `public.verify_call_event_signature_v1()` is safe to expose (boolean only),
--   and is intended to be used by public ingress before any service-role DB calls.

BEGIN;

-- Ensure private schema exists (created in earlier migrations as well).
CREATE SCHEMA IF NOT EXISTS private;

-- Ensure pgcrypto is available for HMAC.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS private.site_secrets (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  current_secret text NOT NULL,
  next_secret text NULL,
  rotated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.site_secrets IS
  'Per-site HMAC secrets for public signed requests (call-event). Not readable by anon/authenticated.';

-- Lock down (defense in depth)
REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
REVOKE ALL ON TABLE private.site_secrets FROM public, anon, authenticated;

-- Fetch secrets (service role only; useful for server tooling, not public ingress)
CREATE OR REPLACE FUNCTION private.get_site_secrets(p_site_id uuid)
RETURNS TABLE (current_secret text, next_secret text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT s.current_secret, s.next_secret
  FROM private.site_secrets s
  WHERE s.site_id = p_site_id;
$$;

REVOKE ALL ON FUNCTION private.get_site_secrets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_site_secrets(uuid) TO service_role;

-- Minimal provisioning/rotation helper (service role only)
CREATE OR REPLACE FUNCTION private.set_site_secrets_v1(
  p_site_id uuid,
  p_current_secret text,
  p_next_secret text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF p_site_id IS NULL THEN
    RAISE EXCEPTION 'site_id is required';
  END IF;
  IF p_current_secret IS NULL OR length(trim(p_current_secret)) < 16 THEN
    RAISE EXCEPTION 'current_secret too short';
  END IF;

  INSERT INTO private.site_secrets (site_id, current_secret, next_secret, rotated_at)
  VALUES (p_site_id, p_current_secret, p_next_secret, CASE WHEN p_next_secret IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (site_id) DO UPDATE SET
    current_secret = EXCLUDED.current_secret,
    next_secret = EXCLUDED.next_secret,
    rotated_at = CASE
      WHEN EXCLUDED.next_secret IS NULL THEN private.site_secrets.rotated_at
      ELSE now()
    END;
END;
$$;

REVOKE ALL ON FUNCTION private.set_site_secrets_v1(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.set_site_secrets_v1(uuid, text, text) TO service_role;

-- Public verifier (boolean only) for /api/call-event signed requests.
-- Caller provides site public id, ts, raw body, and signature.
CREATE OR REPLACE FUNCTION public.verify_call_event_signature_v1(
  p_site_public_id text,
  p_ts bigint,
  p_raw_body text,
  p_signature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_site_id uuid;
  v_curr text;
  v_next text;
  v_msg text;
  v_expected text;
  v_now bigint;
BEGIN
  IF p_site_public_id IS NULL OR length(trim(p_site_public_id)) = 0 THEN
    RETURN false;
  END IF;
  IF p_ts IS NULL OR p_ts <= 0 THEN
    RETURN false;
  END IF;
  IF p_signature IS NULL OR length(p_signature) <> 64 THEN
    RETURN false;
  END IF;

  -- Replay protection (same contract as API layer)
  v_now := extract(epoch from now())::bigint;
  IF v_now - p_ts > 300 THEN
    RETURN false;
  END IF;
  IF p_ts - v_now > 60 THEN
    RETURN false;
  END IF;

  SELECT id INTO v_site_id
  FROM public.sites
  WHERE public_id = p_site_public_id
  LIMIT 1;
  IF v_site_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT current_secret, next_secret
  INTO v_curr, v_next
  FROM private.site_secrets
  WHERE site_id = v_site_id;

  IF v_curr IS NULL OR length(trim(v_curr)) = 0 THEN
    RETURN false;
  END IF;

  v_msg := p_ts::text || '.' || COALESCE(p_raw_body, '');

  v_expected := encode(
    extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_curr, 'utf8'), 'sha256'),
    'hex'
  );
  IF lower(v_expected) = lower(p_signature) THEN
    RETURN true;
  END IF;

  IF v_next IS NOT NULL AND length(trim(v_next)) > 0 THEN
    v_expected := encode(
      extensions.hmac(convert_to(v_msg, 'utf8'), convert_to(v_next, 'utf8'), 'sha256'),
      'hex'
    );
    IF lower(v_expected) = lower(p_signature) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_call_event_signature_v1(text, bigint, text, text) TO anon, authenticated, service_role;

COMMIT;

