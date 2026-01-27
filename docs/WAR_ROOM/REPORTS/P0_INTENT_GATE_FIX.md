# P0_INTENT_GATE_FIX — Ads phone/wa clicks must create call intents (even with gclid)

**Date:** 2026-01-27  
**Severity:** P0  
**System:** Ads Command Center (Ads-only)

---

## Bug (PROVEN)

When `gclid` is present, `/api/sync` rewrites `event_category` to `acquisition` for *all* non-system events.  
Phone/WhatsApp clicks are emitted as `ec='conversion'` but are rewritten to `acquisition`, which prevents call-intent creation because the intent gate requires `finalCategory === 'conversion'`.

**Code proof**

```489:606:app/api/sync/route.ts
// Determine category: GCLID affects only user interactions, not system events
let finalCategory = event_category || 'interaction';

// Override to acquisition only for non-system, non-conversion events with GCLID
// P0: Ads phone/wa clicks are sent as conversion events; do NOT rewrite them,
// otherwise call-intent creation (which gates on finalCategory==='conversion') is skipped.
if (currentGclid && event_category !== 'system' && event_category !== 'conversion') {
    finalCategory = 'acquisition';
}

...
// Step D: Create Call Intent if phone/whatsapp click
if (finalCategory === 'conversion' && fingerprint) {
    const phoneActions = ['phone_call', 'whatsapp', 'phone_click', 'call_click'];
    ...
}
```

---

## Fix (IMPLEMENTED)

**Rule:** Do NOT rewrite conversion events to acquisition.

```sql
-- Acceptance: phone/whatsapp events keep conversion category
SELECT e.event_category, COUNT(*) AS n
FROM public.events e
JOIN public.sessions s ON e.session_id=s.id AND e.session_month=s.created_month
WHERE s.site_id = '<SITE_ID>'
  AND e.created_at BETWEEN '<FROM>' AND '<TO>'
  AND e.event_action IN ('phone_call','whatsapp','phone_click','call_click')
GROUP BY 1
ORDER BY n DESC;
```

Expected:
- `conversion` increases (relative to pre-fix)
- `acquisition` may still exist for non-conversion events

---

## Regression Test (MANDATORY)

**Script:** `scripts/smoke/p0_intent_gate_regression.mjs`

Behavior:
1) POST `/api/sync` with:
   - `ec='conversion'`
   - `ea='phone_call'`
   - `meta.gclid='TEST'`
2) Assert:
   - `events.event_category='conversion' AND event_action='phone_call'`
   - `calls.source='click' AND status='intent' AND matched_session_id=<sid>`

**Acceptance SQL (copy/paste)** (script prints exact ids):

```sql
SELECT id, session_id, session_month, created_at, event_category, event_action
FROM public.events
WHERE session_id='<SID>'
  AND session_month='<SESSION_MONTH>'
  AND event_action='phone_call'
ORDER BY created_at DESC
LIMIT 1;

SELECT id, site_id, created_at, source, status, matched_session_id
FROM public.calls
WHERE site_id='<SITE_ID>'
  AND matched_session_id='<SID>'
  AND source='click'
  AND status='intent'
ORDER BY created_at DESC
LIMIT 1;
```

---

## Rollback signals

- **calls spike:** `calls` inserts/minute per site > **5x** baseline for **15 minutes**
- **ratio collapse:** `ads_only_high_intent / ads_phone_events_anycat` stays < **0.2** for **60 minutes**
- **api errors:** `/api/sync` 5xx > **1%** of requests for **10 minutes**

