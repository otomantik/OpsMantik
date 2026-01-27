# INTENT_RATIO_WATCHDOG — Acceptance Metric (Ads Command Center)

**Severity:** P0 detection  
**Goal:** Automatically detect when Ads phone/WhatsApp clicks stop producing call intents.

---

## Metric definition

For a given `(site_id, date_from, date_to)`:

\[
ratio = \\frac{click\\_intents\\_ads\\_only}{phone\\_events\\_anycat\\_ads\\_only}
\]

- `phone_events_anycat_ads_only`: count of events with actions in:
  - `phone_call`, `whatsapp`, `phone_click`, `call_click`
  for **Ads-only sessions** (per `public.is_ads_session(sess)`), regardless of event_category.
- `click_intents_ads_only`: count of `calls` rows with:
  - `source='click'`
  - `status in ('intent', NULL)`
  - matched to an **Ads-only session in range**

**Broken rule:**
- If `ratio < 0.2` for **30 minutes**, consider system broken.

---

## Implementation (SQL helper)

**Migration:** `supabase/migrations/20260128034000_intent_ratio_watchdog.sql`  
**RPC:** `public.get_intent_ratio_watchdog(p_site_id, p_date_from, p_date_to, p_ads_only default true) -> jsonb`

**Partition-friendly behavior:**
- Uses `sessions.created_month` and `events.session_month` bounds derived from `(p_date_from,p_date_to)`.
- Filters `events` to phone/wa actions only (cheap).
- Filters `calls` using `idx_calls_site_date`.

---

## Acceptance SQL (copy/paste)

```sql
-- Intent ratio watchdog (ads-only)
-- ratio = click_intents_ads_only / phone_events_anycat_ads_only
-- broken if ratio < 0.2 for 30 minutes

WITH s_scope AS (
  SELECT s.id, s.created_month
  FROM public.sessions s
  WHERE s.site_id = '<SITE_ID>'
    AND s.created_at >= '<FROM>'
    AND s.created_at <= '<TO>'
    AND public.is_ads_session(s)
)
SELECT
  (SELECT COUNT(*)
   FROM public.events e
   JOIN s_scope s ON e.session_id = s.id AND e.session_month = s.created_month
   WHERE e.created_at >= '<FROM>' AND e.created_at <= '<TO>'
     AND e.event_action IN ('phone_call','whatsapp','phone_click','call_click')
  ) AS phone_events_anycat_ads_only,
  (SELECT COUNT(*)
   FROM public.calls c
   WHERE c.site_id = '<SITE_ID>'
     AND c.created_at >= '<FROM>' AND c.created_at <= '<TO>'
     AND c.source = 'click'
     AND (c.status = 'intent' OR c.status IS NULL)
     AND EXISTS (SELECT 1 FROM s_scope s WHERE s.id = c.matched_session_id)
  ) AS click_intents_ads_only;
```

---

## Smoke check

**Script:** `scripts/smoke/ratio_watchdog_check.mjs`

- Uses last 30 minutes window (`now-30m .. now+5m`)
- Prints:
  - RPC output (if migration applied)
  - Direct computed output (always)
  - PASS/FAIL

**PASS condition:**
- If `phone_events_anycat_ads_only >= 10` then require `ratio >= 0.2`
- Otherwise PASS with insufficient volume (no alert)

---

## Rollback / alert signals

- Alert: `ratio < 0.2` for 30 minutes (volume ≥ 10)
- Secondary: `/api/sync` 5xx > 1% for 10 minutes
- Secondary: `calls(source='click',status='intent')` drop > 80% vs 7d median

