# Sprint 1 — Attribution & Logic Lockdown — Verification Report

**Initiative:** Systemic Attribution & State Integrity  
**Date:** Sprint 1 completion  
**Status:** ✅ Implemented

---

## 1. GCLID Re-Entry Fix (Attribution Leak)

### 1.1 Client-Side (`public/assets/core.js`)

| Check | Result | Evidence |
|-------|--------|----------|
| New session does not inherit GCLID from sessionStorage when URL has no click ID | ✅ | `getOrCreateSession()`: when `isNewSession === true`, `gclid`/`wbraid`/`gbraid` are taken **only** from `urlParams`; no fallback to `sessionStorage.getItem(CONFIG.contextKey)`. |
| Organic visit clears stored context | ✅ | For new session with no click ID in URL: `sessionStorage.removeItem(CONFIG.contextKey)`, `removeItem(CONFIG.contextWbraidKey)`, `removeItem(CONFIG.contextGbraidKey)` so old attribution is not carried over. |
| Existing session keeps URL-override + stored fallback | ✅ | When `!isNewSession`, logic unchanged: `gclid = urlParams.get('gclid') || context` (and same for wbraid/gbraid). |

**Behavior summary:**  
- **New session:** Attribution only from current URL. If URL has no `gclid`/`wbraid`/`gbraid`, context keys are cleared and `context` is null → organic visits no longer get a previous visit’s GCLID.  
- **Existing session:** Same tab keeps stored context; URL can still override.

### 1.2 Server-Side (`lib/services/session-service.ts`)

| Check | Result | Evidence |
|-------|--------|----------|
| New session treated as clean slate | ✅ | `createSession()` documented: “New session = clean slate for attribution. Only current request’s click IDs (currentGclid, params, meta) are used; client must not send stale GCLID for new sessions.” |
| No server-side reuse of prior session’s GCLID for new sessions | ✅ | New sessions are created only via `createSession()`; it uses only `data.currentGclid`, `data.params`, `data.meta`. No lookup of “previous session” for attribution. Client fix ensures `currentGclid` is not stale on new session. |

---

## 2. State Machine Lockdown (Junk/Cancelled → Seal)

### 2.1 Database Level

| Check | Result | Evidence |
|-------|--------|----------|
| Junk → Seal blocked at RPC | ✅ | Migration `20260326000000_sprint1_state_machine_lockdown.sql`: before applying seal, `IF v_prev_status IN ('junk', 'cancelled') THEN RAISE EXCEPTION 'cannot_seal_from_junk_or_cancelled' USING ERRCODE = 'P0003'; END IF;` |
| Cancelled → Seal blocked at RPC | ✅ | Same guard: `v_prev_status IN ('junk', 'cancelled')`. |
| Transition is impossible at DB level | ✅ | Exception is raised inside the RPC after `FOR UPDATE`; no row is updated. No API or UI can bypass this. |

**How to verify (after applying migration):**

```sql
-- In Supabase SQL or psql (as service_role or with RLS that allows update):
-- 1) Create or pick a call with status = 'junk'
-- 2) Call apply_call_action_v1 with p_action_type = 'seal'
SELECT apply_call_action_v1(
  '<call_uuid>'::uuid,
  'seal',
  '{"sale_amount": 100, "currency": "TRY"}'::jsonb,
  'user', NULL, '{}'::jsonb, NULL
);
-- Expected: ERROR: cannot_seal_from_junk_or_cancelled (SQLSTATE P0003)
```

### 2.2 API Level

| Check | Result | Evidence |
|-------|--------|----------|
| Seal route returns 409 for P0003 | ✅ | `app/api/calls/[id]/seal/route.ts`: if `updateError.code === 'P0003'` or message includes `cannot_seal_from_junk_or_cancelled`, response is 409 with body `{ error: 'Cannot seal: call is junk or cancelled. Restore to queue first.' }`. |

---

## 3. Version Integrity (409 on Conflict)

| Check | Result | Evidence |
|-------|--------|----------|
| Version mismatch returns 409 | ✅ | Seal route: `updateError.code === 'P0002'` or `version mismatch` → 409 “Concurrency conflict: Call was updated by another user. Please refresh and try again.” |
| Junk/cancelled seal returns 409 | ✅ | P0003 → 409 “Cannot seal: call is junk or cancelled. Restore to queue first.” |

So:

- **Junk-to-sealed** is blocked at DB (P0003) and API (409).  
- **Organic visits** no longer receive an old GCLID when a new session starts and the URL has no click ID.

---

## 4. Files Touched

| File | Change |
|------|--------|
| `public/assets/core.js` | New-session attribution only from URL; clear context when new session has no click ID. |
| `lib/services/session-service.ts` | Comment documenting new-session clean slate. |
| `supabase/migrations/20260326000000_sprint1_state_machine_lockdown.sql` | New migration: `apply_call_action_v1` raises P0003 when sealing from junk/cancelled. |
| `app/api/calls/[id]/seal/route.ts` | Handle P0003 with 409; keep P0002 (version mismatch) as 409. |

---

## 5. Deployment Checklist

- [ ] Apply migration: `supabase db push` or run `20260326000000_sprint1_state_machine_lockdown.sql` on target DB.
- [ ] Deploy app (seal route + session-service comment).
- [ ] Deploy tracker: ensure `public/assets/core.js` is served to sites (e.g. cache invalidation if CDN).
- [ ] (Optional) Run SQL verification above for a junk call to confirm P0003.
- [ ] (Optional) E2E: new tab, organic URL, confirm no GCLID in first event payload.

---

**Sprint 1 Verification Report — End**
