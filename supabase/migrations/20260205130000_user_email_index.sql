-- Create an indexed email -> user_id mapping table for scalable customer invites.
-- Problem: Supabase Admin API listUsers() is paginated; a single call only sees the first page.
-- Solution: Maintain public.user_emails via trigger on auth.users for O(1) lookup by email.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_emails (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_lc text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_emails_email_lc ON public.user_emails(email_lc);

-- Lock down: enable RLS; no public policies. service_role bypasses RLS.
ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;

-- Trigger function to keep mapping fresh.
CREATE OR REPLACE FUNCTION public.sync_user_emails_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- NEW.email can be null for some auth providers; ignore such rows.
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_emails (id, email, email_lc, updated_at)
  VALUES (NEW.id, NEW.email, lower(NEW.email), now())
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        email_lc = EXCLUDED.email_lc,
        updated_at = now();

  RETURN NEW;
END;
$$;

-- Attach trigger on auth.users.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_email_sync'
  ) THEN
    CREATE TRIGGER on_auth_user_email_sync
      AFTER INSERT OR UPDATE OF email ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_user_emails_from_auth();
  END IF;
END;
$$;

-- Backfill existing users.
INSERT INTO public.user_emails (id, email, email_lc, updated_at)
SELECT u.id, u.email, lower(u.email), now()
FROM auth.users u
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      email_lc = EXCLUDED.email_lc,
      updated_at = now();

COMMIT;

