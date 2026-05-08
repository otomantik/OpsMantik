-- PR-7E: restore cron lease lock backend for lease_lock_mode=lease runtime.
-- Additive only. No destructive operations.

CREATE TABLE IF NOT EXISTS public.cron_leases (
  lock_name text PRIMARY KEY,
  owner_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.cron_leases
  IS 'Distributed cron lease locks. One row per lock_name with owner token and expiry.';

ALTER TABLE public.cron_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cron_leases FROM PUBLIC;
REVOKE ALL ON TABLE public.cron_leases FROM anon;
REVOKE ALL ON TABLE public.cron_leases FROM authenticated;

CREATE OR REPLACE FUNCTION public.acquire_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_ttl integer := GREATEST(COALESCE(p_ttl_seconds, 0), 1);
  v_expires_at timestamptz := v_now + make_interval(secs => v_ttl);
  v_inserted boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'acquire_cron_lease_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_lock_name, '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NULLIF(trim(COALESCE(p_owner_token, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cron_leases
  SET
    owner_token = p_owner_token,
    expires_at = v_expires_at,
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND expires_at <= v_now;

  IF FOUND THEN
    RETURN true;
  END IF;

  BEGIN
    INSERT INTO public.cron_leases(lock_name, owner_token, expires_at, acquired_at, updated_at)
    VALUES (p_lock_name, p_owner_token, v_expires_at, v_now, v_now);
    v_inserted := true;
  EXCEPTION
    WHEN unique_violation THEN
      v_inserted := false;
  END;

  IF v_inserted THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.acquire_cron_lease_v1(text, text, integer)
  IS 'Acquire cron lease lock with ttl; succeeds on new or expired lock row. service_role only.';

CREATE OR REPLACE FUNCTION public.steal_expired_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer,
  p_grace_seconds integer DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_ttl integer := GREATEST(COALESCE(p_ttl_seconds, 0), 1);
  v_grace integer := GREATEST(COALESCE(p_grace_seconds, 10), 0);
  v_cutoff timestamptz := v_now - make_interval(secs => v_grace);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'steal_expired_cron_lease_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_lock_name, '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NULLIF(trim(COALESCE(p_owner_token, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cron_leases
  SET
    owner_token = p_owner_token,
    expires_at = v_now + make_interval(secs => v_ttl),
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND expires_at < v_cutoff;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer)
  IS 'Steal cron lease lock only when lock is expired beyond grace period. service_role only.';

CREATE OR REPLACE FUNCTION public.heartbeat_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_ttl integer := GREATEST(COALESCE(p_ttl_seconds, 0), 1);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'heartbeat_cron_lease_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_lock_name, '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NULLIF(trim(COALESCE(p_owner_token, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cron_leases
  SET
    expires_at = v_now + make_interval(secs => v_ttl),
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer)
  IS 'Extend ttl for an owned cron lease lock. service_role only.';

CREATE OR REPLACE FUNCTION public.release_cron_lease_v1(
  p_lock_name text,
  p_owner_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'release_cron_lease_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_lock_name, '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NULLIF(trim(COALESCE(p_owner_token, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.cron_leases
  WHERE lock_name = p_lock_name
    AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_cron_lease_v1(text, text)
  IS 'Release cron lease lock only when owner token matches. service_role only.';

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock_v1(
  p_lock_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner text := format('legacy-fallback:%s', txid_current()::text);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'try_acquire_cron_lock_v1 may only be called by service_role'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_lock_key, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.acquire_cron_lease_v1(p_lock_key, v_owner, 60);
END;
$$;

COMMENT ON FUNCTION public.try_acquire_cron_lock_v1(text)
  IS 'Legacy fallback lock acquire path (no explicit release) with short ttl lease. service_role only.';

REVOKE ALL ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.release_cron_lease_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_cron_lease_v1(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.release_cron_lease_v1(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_cron_lease_v1(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.try_acquire_cron_lock_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_cron_lock_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.try_acquire_cron_lock_v1(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_cron_lock_v1(text) TO service_role;
