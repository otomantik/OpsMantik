BEGIN;

CREATE TABLE IF NOT EXISTS public.user_emails (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_lc text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_emails (id, email, email_lc)
SELECT u.id, u.email, lower(u.email)
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    email_lc = EXCLUDED.email_lc,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.customer_invite_audit (
  id bigserial PRIMARY KEY,
  inviter_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL,
  invitee_email text NOT NULL,
  invitee_email_lc text NOT NULL,
  role text NOT NULL,
  outcome text NOT NULL,
  details text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_invite_audit_site_created
  ON public.customer_invite_audit(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_snapshot (
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  snapshot_hash text NOT NULL,
  payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, year_month)
);

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_invite_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_emails'
      AND policyname = 'user_emails_service_role'
  ) THEN
    CREATE POLICY user_emails_service_role ON public.user_emails
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_invite_audit'
      AND policyname = 'customer_invite_audit_service_role'
  ) THEN
    CREATE POLICY customer_invite_audit_service_role ON public.customer_invite_audit
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_snapshot'
      AND policyname = 'invoice_snapshot_service_role'
  ) THEN
    CREATE POLICY invoice_snapshot_service_role ON public.invoice_snapshot
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_emails TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_invite_audit TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_snapshot TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.customer_invite_audit_id_seq TO service_role;

COMMIT;
