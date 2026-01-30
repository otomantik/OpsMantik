# GO 2.1 — AUTOPROOF PACK (RLS sites.config + calls UPDATE)

**GO:** 2.1 (one PR).  
**Scope:** Fix RLS for sites.config (owner/editor only); harden calls UPDATE (owner/editor/admin); Seal API site_id from DB only.  
**Date:** 2026-01-30

---

## 1) Files touched

| Action | Path |
|--------|------|
| Added | `supabase/migrations/20260130200000_go21_sites_config_calls_update_rls.sql` |
| Modified | `app/api/calls/[id]/seal/route.ts` (comment: site_id from DB only) |
| Added | `docs/WAR_ROOM/EVIDENCE/GO2_1_RLS/AUTOPROOF_PACK.md` |
| Added | `docs/WAR_ROOM/EVIDENCE/GO2_1_RLS/SQL_PROOF.md` |

---

## 2) Key diff hunks

### A) sites UPDATE policy

- Dropped: "Users can update their own sites", "Admins can update sites".
- Created: "Site owners and editors can update sites" — USING/WITH CHECK: `(sites.user_id = auth.uid()) OR (EXISTS site_members WHERE role IN ('owner','editor')) OR is_admin(auth.uid())`. Viewers cannot update.

### B) calls RLS

- Dropped: "calls_tenant_isolation_iron_dome" (FOR ALL).
- Created: "calls_select_accessible" (FOR SELECT) — owner or any member or admin.
- Created: "calls_update_owner_editor_admin" (FOR UPDATE) — owner or site_members.role IN ('owner','editor') or admin (viewers cannot update).
- Created: "calls_insert_owner_editor_admin", "calls_delete_owner_editor_admin" for consistency.

### C) Seal API

- No client site_id: fetch call by id → get site_id from DB → validateSiteAccess(site_id, user) → update. Comment added: "site_id from DB only — do NOT accept site_id from client".

### Seal path allowed columns (unchanged; trigger enforces)

- sale_amount, estimated_value (optional), currency, status, confirmed_at, confirmed_by, note (+ lead_score, oci_status, oci_status_updated_at per existing trigger).

---

## 3) SQL proof (paste outputs)

### 3.1 Policy dump (pg_policies)

Run in Supabase SQL Editor (after applying migration):

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('sites', 'calls')
ORDER BY tablename, policyname;
```

**Paste result:**

```
-- Example (replace with actual output):
 schemaname | tablename | policyname                          | roles        | cmd    | qual | with_check
------------+-----------+--------------------------------------+--------------+--------+------+------------
 public     | sites     | Site owners and editors can update sites | {authenticated} | UPDATE | ... | ...
 public     | sites     | Users can view owned or member sites | ...           | SELECT | ... | ...
 public     | calls     | calls_delete_owner_editor_admin      | ...           | DELETE | ... | ...
 public     | calls     | calls_insert_owner_editor_admin      | ...           | INSERT | ... | ...
 public     | calls     | calls_select_accessible             | ...           | SELECT | ... | ...
 public     | calls     | calls_update_owner_editor_admin     | ...           | UPDATE | ... | ...
```

### 3.2 Negative / positive tests (SQL doc)

See `docs/WAR_ROOM/EVIDENCE/GO2_1_RLS/SQL_PROOF.md`:

- **Viewer cannot update sites.config:** Run as viewer → `UPDATE sites SET config = '{}' WHERE id = <site_id>` → expect RLS denial (no row updated or error).
- **Owner/editor can update sites.config:** Run as owner or editor → same UPDATE → expect success.

**Paste result:** (output of policy dump + one-line result of negative/positive tests).

---

## 4) Smoke proof

**Command (must PASS):**

```bash
node scripts/smoke/casino-ui-proof.mjs
```

**Expected:** Test call id … status: intent → Seal API OK → DB verified: sale_amount=1000, status=confirmed → GO2 Casino UI smoke: PASS.

**Paste result or log path:** `docs/WAR_ROOM/EVIDENCE/GO2_CASINO_UI/smoke_log.txt` (or inline PASS output).

---

## 5) Build proof

**Command:** `npm run build`

**Log:** `docs/WAR_ROOM/EVIDENCE/GO2_1_RLS/build_log.txt`

**Excerpt:**

```
> next build
▲ Next.js 16.1.4 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in X.Xs
  Running TypeScript ...
```

Run locally; paste excerpt or attach build_log.txt. Must show compile success.

---

## 6) PASS/FAIL checklist

| Item | PASS/FAIL |
|------|-----------|
| Migration applies without error | |
| Policy dump: sites has "Site owners and editors can update sites" (UPDATE) | |
| Policy dump: calls has calls_select_accessible, calls_update_owner_editor_admin | |
| Negative test: viewer cannot update sites.config | |
| Positive test: owner/editor can update sites.config | |
| Seal API: site_id from DB only (no client authority) | |
| Smoke: node scripts/smoke/casino-ui-proof.mjs PASS | |
| npm run build PASS | |
