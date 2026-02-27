# OpsMantik Performance Audit — Diagnosis Report

## 1. The 3 Biggest Performance Killers

### Killer #1: Sequential call → session fetches (primary-source, consent-check)

**Location:** `lib/conversation/primary-source.ts`, `lib/gdpr/consent-check.ts`

**Pattern:** Two sequential DB round-trips per request:
1. `SELECT matched_session_id FROM calls WHERE id = $1 AND site_id = $2`
2. `SELECT gclid, wbraid, ... FROM sessions WHERE id = $sessionId AND site_id = $2`

**Impact:** Every OCI enqueue (enqueueSealConversion) does 2 calls for primary-source (gclid) and 2 for consent-check. That’s **4 round-trips per sealed call** before the insert. Under load this multiplies latency and connection usage.

---

### Killer #2: RLS policies with correlated subqueries on hot tables

**Location:** `calls_select_accessible` policy (20260130220000_go21_calls_select_visible.sql)

**Pattern:**
```sql
(SELECT s.user_id FROM public.sites s WHERE s.id = public.calls.site_id LIMIT 1) = auth.uid()
OR EXISTS (SELECT 1 FROM public.site_members sm WHERE sm.site_id = public.calls.site_id AND sm.user_id = auth.uid())
OR public.is_admin(auth.uid())
```

**Impact:** For each row in `calls`, Postgres runs 2–3 subqueries (sites lookup, site_members lookup, is_admin). On large `calls` tables this slows every SELECT. `sites.id` and `site_members(site_id, user_id)` are indexed, but the policy is evaluated row-by-row.

---

### Killer #3: Missing composite index for visitor history

**Location:** `lib/hooks/use-visitor-history.ts` query:
```ts
.from('calls').select(...).eq('matched_fingerprint', fingerprint).eq('site_id', siteId)
```

**Pattern:** Filter by `site_id` and `matched_fingerprint`.

**Impact:** `idx_calls_site_id` and `idx_calls_fingerprint` (if present) exist as separate indexes. A composite `(site_id, matched_fingerprint)` would let Postgres use a single index scan. Without it, the planner may do an index scan on one column and filter on the other.

---

## 2. Over-Fetching & N+1

| Location | Issue | Severity |
|----------|-------|----------|
| `app/api/sales/route.ts` | `select('*')` after update — only needs a few columns | Low |
| `components/dashboard/session-group.tsx` | Each `SessionGroup` fetches its own call via `useEffect` | Medium (N queries for N groups) |
| `use-intent-qualification.ts` | N seal HTTP requests for N calls in session | By design — batch seal API could reduce round-trips |
| `lib/services/watchtower.ts` | `select('*', { head: true })` — count only, no row fetch | OK |

---

## 3. RLS Policy Optimization

- **can_access_site()** exists and is used by some policies. The `calls_select_accessible` policy uses raw subqueries instead. Switching to `can_access_site(auth.uid(), site_id)` would centralize logic and can help the planner if the function is inlined.
- **conversations, sales, conversation_links** all use `EXISTS (SELECT 1 FROM sites s JOIN site_members sm ...)`. These are standard patterns; ensure `site_members(site_id, user_id)` has a composite index (it does: `idx_site_members_site_user`).

---

## 4. Deliverables

| File | Purpose |
|------|---------|
| `docs/performance-audit-diagnosis.md` | This diagnosis report |
| `supabase/migrations/20260307000000_get_call_session_for_oci_rpc.sql` | RPC: call + session in 1 round-trip |
| `supabase/migrations/20260307000001_audit_performance_indexes.sql` | Composite indexes for calls |
| `lib/conversation/primary-source.ts` | Uses RPC for call path (1 instead of 2 queries) |
| `lib/gdpr/consent-check.ts` | Uses RPC (1 instead of 2 queries) |
