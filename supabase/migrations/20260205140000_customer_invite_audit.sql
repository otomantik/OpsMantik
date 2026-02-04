-- Audit log for customer invites (who invited whom, to which site, when, and outcome).
-- RLS enabled; no public policies. Intended for admin/service_role inspection only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_invite_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  inviter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  invitee_email text NOT NULL,
  invitee_email_lc text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor', 'owner')),

  -- Outcome fields
  outcome text NOT NULL,
  details text NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_invite_audit_site_id ON public.customer_invite_audit(site_id);
CREATE INDEX IF NOT EXISTS idx_customer_invite_audit_inviter_user_id ON public.customer_invite_audit(inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_invite_audit_invitee_email_lc ON public.customer_invite_audit(invitee_email_lc);
CREATE INDEX IF NOT EXISTS idx_customer_invite_audit_created_at ON public.customer_invite_audit(created_at DESC);

ALTER TABLE public.customer_invite_audit ENABLE ROW LEVEL SECURITY;

COMMIT;

