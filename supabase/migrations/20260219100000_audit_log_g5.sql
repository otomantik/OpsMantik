-- PR-G5: Generic audit log for billing/admin/sensitive actions.
-- Tier-1 roadmap: "audit log table and write path for billing/admin".
-- Append-only; INSERT via service_role only; SELECT for admin/service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service_role', 'cron')),
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  action text NOT NULL,
  resource_type text NULL,
  resource_id text NULL,
  site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.audit_log IS
'PR-G5: Append-only audit trail for billing, admin, and sensitive actions. Write path only via service_role.';

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_site_id ON public.audit_log(site_id, created_at DESC) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role can INSERT (no policy = deny; service_role bypasses RLS by default in Supabase)
-- Restrict SELECT to service_role so only backend/cron can read (no authenticated policy)
CREATE POLICY audit_log_select_service_role ON public.audit_log
  FOR SELECT TO service_role USING (true);

-- Authenticated: no INSERT (cron and API use service_role client)
-- Result: only service_role can read and write.

COMMIT;
