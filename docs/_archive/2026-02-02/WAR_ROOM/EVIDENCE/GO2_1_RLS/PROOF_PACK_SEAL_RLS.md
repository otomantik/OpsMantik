# GO 2.1 — Fix RLS visibility for calls + Seal API (Proof Pack)

## Summary

- **Problem:** casino-ui-proof --inject fails with 404 (PGRST116); RLS hid the call row from the authenticated proof user.
- **Fix:** Seal API uses **admin client only for lookup** (id → site_id); **validateSiteAccess**; **user client for UPDATE** (RLS enforced). No client input for site_id.
- **Migration:** calls SELECT (owner, any member incl viewer, admin); calls UPDATE (owner/editor/admin); sites config UPDATE (owner/editor/admin); oci_status column.

---

## A) Calls SELECT policy (P0)

- **Policy:** `calls_select_accessible` (migration `20260130220000_go21_calls_select_visible.sql`).
- **Condition:** Site owner (`sites.user_id = auth.uid()`) OR any site member (`site_members`, any role including viewer) OR admin (`is_admin(auth.uid())`).
- Viewers can SELECT (dashboard queue).

## B) Calls UPDATE policy (P0)

- **Policy:** `calls_update_own_site_members` (migration `20260130210000_go21_seal_rls_oci_status.sql`).
- **Condition:** Site owner OR site_members with role in ('owner','editor') OR admin. Viewers cannot UPDATE.
- Seal route updates only: sale_amount, currency, status, confirmed_at, confirmed_by, oci_status, oci_status_updated_at (trigger enforces allowed columns).

## C) Sites config UPDATE policy (P0)

- **Policy:** "Site owners and editors can update sites" (migration `20260130200000_go21_sites_config_calls_update_rls.sql`).
- Owner, editor/owner member, or admin can UPDATE sites (including config).

## D) Seal API robustness (P0)

- **Lookup:** `adminClient.from('calls').select('id, site_id').eq('id', callId).maybeSingle()` — no client input for site_id.
- **Access:** `validateSiteAccess(siteId, user.id, userClient)` — 404 if not allowed (do not leak).
- **Update:** `userClient.from('calls').update(...)` — RLS enforced.
- **Response:** 404 for "not found" or "no access" (same message); 409 if already confirmed.

## E) Smoke script

- Prints: proof user id, proof user site_id, test call id, call site_id, status, Seal API result, DB verified.

---

## PROOF PACK (Mandatory)

### 1) Migration(s)

- `supabase/migrations/20260130200000_go21_sites_config_calls_update_rls.sql` — sites UPDATE.
- `supabase/migrations/20260130210000_go21_seal_rls_oci_status.sql` — calls UPDATE + oci_status.
- `supabase/migrations/20260130220000_go21_calls_select_visible.sql` — calls SELECT.

### 2) pg_policies dump (before/after)

```sql
-- After applying migrations
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual::text, with_check::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('calls', 'sites')
ORDER BY tablename, policyname;
```

Paste result into this doc or AUTOPROOF_PACK.

### 3) Build

```bash
npm run build
```

**Expected:** PASS (no errors).

### 4) Smoke test (full logs)

```bash
node scripts/smoke/casino-ui-proof.mjs --inject
```

**Expected output (example):**

```
Proof user id: <uuid>
Proof user site_id: <uuid>
Test call id: <uuid> call site_id: <uuid> status: intent
Seal API result: {"success":true,"call":{...}}
DB verified: sale_amount=1000, status=confirmed
GO2 Casino UI smoke: PASS. Log: ...
```

**Paste full logs here:** _______________________

### 5) PASS/FAIL checklist

| Item | Status |
|------|--------|
| Migrations applied (db push) | ☐ PASS / ☐ FAIL |
| pg_policies dump for calls, sites | ☐ PASS / ☐ FAIL |
| npm run build | ☐ PASS / ☐ FAIL |
| node scripts/smoke/casino-ui-proof.mjs --inject | ☐ PASS / ☐ FAIL |
