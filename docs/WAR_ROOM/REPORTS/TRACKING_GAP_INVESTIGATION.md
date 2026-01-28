# Tracking Gap Investigation — Ads Clicks vs Sessions vs Intents

**Project:** OpsMantik Ads Command Center  
**Date:** 2026-01-28  
**Reported symptom:** “Google Ads shows ~205 clicks, we see ~185 sessions; also Queue shows fewer intents than DB.”

---

## 1) Definitions (so we don’t compare apples to oranges)

### 1.1 Google Ads “Clicks”
Google Ads click count is **ad interactions**, not guaranteed page loads.
Common cases:
- Same user clicks multiple times (multiple clicks → 1 session)
- Clicks that bounce before JS runs (network/cancel/blocked)
- Clicks to call extensions / WhatsApp / deep links that never load the site

### 1.2 “Sessions” in OpsMantik
A session exists only if:
- the landing page loads, and
- the OpsMantik script runs and posts the session/event payload

### 1.3 “Intents” in OpsMantik (Phone/WhatsApp/Form)
An “intent” exists only if:
- the user performs a tracked action (phone click, whatsapp click, form_submit), and
- we successfully capture/insert the call/intent row

So **Clicks ≥ Sessions ≥ Intents** is normal.

---

## 2) Why 205 clicks can produce 185 sessions (most likely causes)

### A) Multiple clicks per same session
1 person can click 2–3 times (especially if searching prices).
Ads “clicks” counts each.
Sessions count once.

### B) Landing page did not fully load (script not executed)
Causes:
- slow network / user closes early
- browser blocks third‑party scripts
- ad goes to a page that 404s or redirects to a non-instrumented domain
- consent banner blocks initialization until accepted

### C) Clicks that never hit the site
Examples:
- Call extension click on Google SERP
- WhatsApp deep link (opens app directly)
- Incorrect final URL / tracking template misroute

### D) GCLID/WBRAID/GBRAID missing or stripped
If the click-id is missing, attribution can become “unknown” (still a session, but not “Ads session”).
Common when:
- redirects remove query params
- server-side rewrites drop parameters
- privacy features remove parameters

### E) Bot/invalid clicks filtered differently
Google Ads may count clicks that you later filter or ignore server-side.

---

## 3) Why “DB has 29/17 intents but dashboard shows fewer”

This can happen if the UI reads from a different source than your “DB query”.

### Old Queue bug (fixed)
Queue was reading directly from `calls` and filtering strictly:
- `status = 'intent'` AND `lead_score = 0`

If legacy rows have:
- `status IS NULL` (allowed by schema/older rows)
- `lead_score IS NULL`
then they disappear from the Queue.

### New Queue behavior (current)
Queue now uses the same source-of-truth as Live Inbox:
- RPC: `get_recent_intents_v1` (ads-only, minimal join)
- then client-side filters:
  - `status IN (NULL, 'intent')`
  - `lead_score IN (NULL, 0)`

This removes drift between “DB view” and “dashboard view”.

---

## 4) What we need to measure (to prove the gap)

### 4.1 SQL checks (Supabase)
Run these in Supabase SQL editor for your `site_id`.

**A) Sessions today (TRT range)**
```sql
-- Replace :site_id, :from, :to
select count(*) as sessions
from public.sessions
where site_id = :site_id
  and created_at >= :from
  and created_at <  :to;
```

**B) Ads sessions today**
```sql
select count(*) as ads_sessions
from public.sessions
where site_id = :site_id
  and created_at >= :from
  and created_at <  :to
  and public.is_ads_session(sessions);
```

**C) Click intents today (calls.source='click')**
```sql
select
  intent_action,
  count(*) as intents
from public.calls
where site_id = :site_id
  and created_at >= :from
  and created_at <  :to
  and source = 'click'
group by 1
order by 2 desc;
```

**D) Unscored intents (status NULL or intent, lead_score NULL or 0)**
```sql
select count(*) as unscored
from public.calls
where site_id = :site_id
  and source = 'click'
  and (status is null or status = 'intent')
  and (lead_score is null or lead_score = 0);
```

### 4.2 Client evidence (Browser DevTools)
On landing:
- Confirm `sessions` insert/event network call occurs
- Confirm click handlers fire for whatsapp/phone
- Confirm calls row insert happens when click happens

---

## 5) Next engineering steps (if you want to reduce the gap)

### P1 — Capture more sessions
- Ensure tracking script loads **before** consent gating, or replays initialization after consent.
- Ensure redirects preserve query params (gclid/wbraid/gbraid).
- Add a lightweight server endpoint that logs “landing hit” even if JS never runs (optional).

### P2 — Capture more intents
- Make click listeners robust:
  - event delegation
  - capture phase
  - handle SPA navigation
- Ensure WhatsApp links (wa.me) are instrumented consistently.

### P3 — Attribution hardening
- Persist click_id in first-party storage (cookie/localStorage) at landing.
- Join intent to session via fingerprint and time window if session id missing.

---

## 6) Bottom line

**205 clicks vs 185 sessions** is not automatically a bug — it’s often expected.  
But we can (and should) measure where the 20 clicks go:
- never loaded page,
- loaded but script blocked,
- loaded but lost click-id,
- or loaded but filtered out of ads-only view.

This report is designed to be handed to another model/engineer (“Gemini”) to run the checks and propose the next hardening changes.

