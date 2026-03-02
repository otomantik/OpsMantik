-- PR-T1: Strict ingest activation for a site.
-- Run with a real site UUID. Merges into existing config (does not replace).
-- ingest_strict_mode enables: traffic_debloat, ghost_geo_strict, page_view_10s_session_reuse semantics.

-- Replace [SITE_ID] with the target site UUID, then execute:

UPDATE sites
SET config = config || '{"ingest_strict_mode": true}'::jsonb
WHERE id = '[SITE_ID]';

-- Optional: enable only traffic_debloat (bot/referrer gates, no 10s reuse or ghost geo):
-- UPDATE sites SET config = config || '{"traffic_debloat": true}'::jsonb WHERE id = '[SITE_ID]';

-- Verify (replace [SITE_ID]):
-- SELECT id, config FROM sites WHERE id = '[SITE_ID]';
