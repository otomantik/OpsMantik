# P0 Intent Gate Debug Audit

## 1. Environment Alignment (Physical Connection)

| Layer | Source | Supabase URL |
|-------|--------|--------------|
| **P0 test** | `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` → `https://api.opsmantik.com` |
| **Production sync** | Vercel env | `NEXT_PUBLIC_SUPABASE_URL` (Vercel project settings) |
| **Production worker** | Vercel env | Same as sync (worker runs on Vercel) |

**Critical:** P0 reads from the Supabase project in `.env.local`. The sync route and worker write to the Supabase project in **Vercel** env. If these are different projects, events are written to one DB and P0 reads from another → `event_row_missing` / `call_intent_missing`.

**Check:** Vercel → Project → Settings → Environment Variables → `NEXT_PUBLIC_SUPABASE_URL`. Should be `https://api.opsmantik.com`. Must match.

---

## 2. Constants Verification

| Test expects | Code uses | Match |
|--------------|-----------|-------|
| `events.event_action` = `phone_call` | `IntentService` PHONE_ACTIONS includes `phone_call` | ✅ |
| `calls.status` = `intent` | `ensure_session_intent_v1` inserts `status = 'intent'` | ✅ |
| `calls.source` = `click` | `ensure_session_intent_v1` inserts `source = 'click'` | ✅ |
| `calls.matched_session_id` = sid | IntentService passes `session.id` (same as sid when new) | ✅ |
| `events.session_id` = sid | SessionService uses `client_sid` as session id when new | ✅ |

**Conclusion:** String constants match. The test queries are correct.

---

## 3. Data Flow (Sync → Events → Calls)

```
POST /api/sync (202)
  → QStash publish
  → POST /api/workers/ingest (QStash calls this)
    → processSyncEvent()
      → SessionService.handleSession()  → session (id = sid when new)
      → EventService.createEvent()     → events row (session_id = sid)
      → IntentService.handleIntent()   → ensure_session_intent_v1 RPC
        → calls row (matched_session_id = sid, status = 'intent', source = 'click')
```

**Note:** `processCallEvent` (AdsContext, etc.) is for **call-event API**, not sync. Sync uses `processSyncEvent` → `IntentService.handleIntent` → `ensure_session_intent_v1`. No AdsContext validation in sync flow.

---

## 4. Worker Logs (Manual Check)

1. Vercel Dashboard → Project → Logs
2. Filter: `/api/workers/ingest`
3. Find request with `ingest_id: a9753f80-ee90-4523-ac4e-5e4194d0c604` (from last P0 run)
4. Check: status 200? Any error in response body?

If worker returned 200 with `{ ok: true, reason: '...' }` (idempotency/quota) → no event written.
If worker crashed → check stack trace.
If no log for that ingest_id → QStash may not have delivered.

---

## 5. Verify Data in Supabase (Production)

Run in Supabase SQL Editor (use **production** project):

```sql
-- Replace with last P0 run values (from console output)
-- sid, sm, site internal uuid, ingest_id

-- Check processed_signals (dedup before event)
SELECT * FROM public.processed_signals 
WHERE site_id = '<internal_site_uuid>' 
ORDER BY created_at DESC LIMIT 5;

-- Check events (recent phone_call)
SELECT id, session_id, session_month, event_category, event_action, created_at 
FROM public.events 
WHERE event_action = 'phone_call' 
ORDER BY created_at DESC LIMIT 10;

-- Check calls (recent intent)
SELECT id, site_id, matched_session_id, source, status, intent_action, created_at 
FROM public.calls 
WHERE source = 'click' AND status = 'intent'
ORDER BY created_at DESC LIMIT 10;
```

If rows exist in production Supabase but P0 uses a different Supabase URL → **environment mismatch confirmed**.

---

## 6. Summary

| Check | Result |
|-------|--------|
| Constants (event_action, status, source) | ✅ Match |
| Sync flow path | Sync → processSyncEvent → IntentService → ensure_session_intent_v1 |
| AdsContext in sync flow | ❌ Not used (call-event only) |
| Most likely root cause | **Supabase URL mismatch** (P0 .env.local ≠ Vercel) |

**Action:** Confirm Vercel `NEXT_PUBLIC_SUPABASE_URL` equals `.env.local`. If different, either:
- Point `.env.local` to production Supabase for P0, or
- Add a diagnostic route that returns (redacted) env alignment status for CI.
