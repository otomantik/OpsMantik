-- Harden user_emails mapping:
-- - Ensure mapping is removed when auth.users.email becomes NULL/blank
-- - Recreate trigger with table-specific existence checks
-- - Enforce invariant: email_lc = lower(email)

BEGIN;

-- Enforce invariant with a CHECK constraint (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_emails_email_lc_lower_check'
  ) THEN
    ALTER TABLE public.user_emails
      ADD CONSTRAINT user_emails_email_lc_lower_check
      CHECK (email_lc = lower(email));
  END IF;
END;
$$;

-- Replace trigger function with NULL/blank cleanup behaviour.
CREATE OR REPLACE FUNCTION public.sync_user_emails_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If email is removed/blanked, delete mapping row.
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    DELETE FROM public.user_emails ue WHERE ue.id = NEW.id;
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

-- Drop and recreate trigger to ensure it's attached to auth.users.
DROP TRIGGER IF EXISTS on_auth_user_email_sync ON auth.users;

CREATE TRIGGER on_auth_user_email_sync
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_emails_from_auth();

-- Backfill existing users again (safe/idempotent).
INSERT INTO public.user_emails (id, email, email_lc, updated_at)
SELECT u.id, u.email, lower(u.email), now()
FROM auth.users u
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      email_lc = EXCLUDED.email_lc,
      updated_at = now();

COMMIT;

