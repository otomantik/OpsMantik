-- Eslamed: Stuck PROCESSING rows → RETRY (recover cron does this automatically every 10 min)
-- Use this for manual recovery when cron hasn't run yet.
-- Site: b1264552-c859-40cb-a3fb-0ba057afd070

UPDATE offline_conversion_queue
SET status = 'RETRY', next_retry_at = NULL, claimed_at = NULL, updated_at = now()
WHERE site_id = 'b1264552-c859-40cb-a3fb-0ba057afd070'
  AND status = 'PROCESSING';
