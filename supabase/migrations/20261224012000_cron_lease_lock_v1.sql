-- Integrity remediation PR-7:
-- Durable DB lease lock primitives for cron jobs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_leases (
  lock_name text PRIMARY KEY,
  owner_token text NOT NULL,
  locked_until timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_leases_locked_until ON public.cron_leases (locked_until);

CREATE OR REPLACE FUNCTION public.acquire_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_lock_name IS NULL OR btrim(p_lock_name) = '' OR p_owner_token IS NULL OR btrim(p_owner_token) = '' THEN
    RETURN false;
  END IF;

  UPDATE public.cron_leases
  SET
    owner_token = p_owner_token,
    locked_until = v_now + make_interval(secs => GREATEST(1, p_ttl_seconds)),
    last_heartbeat = v_now,
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND (locked_until <= v_now OR owner_token = p_owner_token);
  IF FOUND THEN
    RETURN true;
  END IF;

  INSERT INTO public.cron_leases(lock_name, owner_token, locked_until, acquired_at, last_heartbeat, updated_at)
  VALUES (
    p_lock_name,
    p_owner_token,
    v_now + make_interval(secs => GREATEST(1, p_ttl_seconds)),
    v_now,
    v_now,
    v_now
  )
  ON CONFLICT (lock_name) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.cron_leases
  SET
    locked_until = v_now + make_interval(secs => GREATEST(1, p_ttl_seconds)),
    last_heartbeat = v_now,
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND owner_token = p_owner_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lease_v1(
  p_lock_name text,
  p_owner_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.cron_leases
  WHERE lock_name = p_lock_name
    AND owner_token = p_owner_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.steal_expired_cron_lease_v1(
  p_lock_name text,
  p_owner_token text,
  p_ttl_seconds integer DEFAULT 600,
  p_grace_seconds integer DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.cron_leases
  SET
    owner_token = p_owner_token,
    locked_until = v_now + make_interval(secs => GREATEST(1, p_ttl_seconds)),
    last_heartbeat = v_now,
    updated_at = v_now
  WHERE lock_name = p_lock_name
    AND locked_until < v_now - make_interval(secs => GREATEST(0, p_grace_seconds));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON TABLE public.cron_leases FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cron_leases TO service_role;

REVOKE ALL ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.release_cron_lease_v1(text, text) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.acquire_cron_lease_v1(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_cron_lease_v1(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lease_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.steal_expired_cron_lease_v1(text, text, integer, integer) TO service_role;

COMMIT;
