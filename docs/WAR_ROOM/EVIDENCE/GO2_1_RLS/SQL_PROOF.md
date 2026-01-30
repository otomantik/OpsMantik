# GO 2.1 — SQL proof (policy dump + negative/positive tests)

Run after applying migration `20260130200000_go21_sites_config_calls_update_rls.sql`.

---

## 1) Policy dump

```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('sites', 'calls')
ORDER BY tablename, policyname;
```

**Paste result below:**

---

## 2) Negative test: viewer cannot update sites.config

Prerequisite: One site, one user with `site_members.role = 'viewer'` for that site.

As that viewer (authenticated session or service_role impersonation), run:

```sql
-- As viewer: update a site they are viewer of (replace <site_id> with real id)
UPDATE public.sites
SET config = '{"bounty_chips":[1000,5000],"currency":"TRY"}'::jsonb
WHERE id = '<site_id>';
```

**Expected:** 0 rows updated (RLS denies UPDATE to viewers). Or run via app with viewer token → 403/forbidden.

**Paste result:** `0 rows updated` or error message.

---

## 3) Positive test: owner/editor can update sites.config

As site owner (sites.user_id = auth.uid()) or as a user with site_members.role IN ('owner','editor'):

```sql
-- As owner or editor (replace <site_id> with site they own or have editor role)
UPDATE public.sites
SET config = '{"bounty_chips":[1000,5000,10000,25000],"currency":"TRY"}'::jsonb
WHERE id = '<site_id>'
RETURNING id, config;
```

**Expected:** 1 row updated; RETURNING shows new config.

**Paste result:** 1 row, config = {"bounty_chips":[1000,5000,10000,25000],"currency":"TRY"} (or equivalent).

---

## 4) Constraint / column existence (optional)

Calls whitelist is enforced by trigger `calls_enforce_update_columns` (unchanged). Allowed columns: sale_amount, estimated_value, currency, status, confirmed_at, confirmed_by, note, lead_score, oci_status, oci_status_updated_at.

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.calls'::regclass AND contype = 'c';
```

Paste if needed for proof.
