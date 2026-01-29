-- Schedule partition maintenance via pg_cron (internal only; no Edge Function or external cron).
-- Prerequisite: Enable "pg_cron" in Supabase Dashboard → Database → Extensions.
-- Runs create_next_month_partitions() on the 25th of each month at 03:00 UTC so next month's tables exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not enabled. Enable it in Dashboard → Database → Extensions, then re-run migrations or run this block manually.';
    RETURN;
  END IF;

  -- Remove existing job if any (idempotent)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'maintain-partitions') THEN
    PERFORM cron.unschedule('maintain-partitions');
  END IF;

  -- Run on 25th of each month at 03:00
  PERFORM cron.schedule(
    'maintain-partitions',
    '0 3 25 * *',
    'SELECT public.create_next_month_partitions()'
  );
  RAISE NOTICE 'pg_cron: maintain-partitions scheduled for 25th of each month at 03:00.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule failed: %. Enable pg_cron in Dashboard and re-run.', SQLERRM;
END;
$$;
