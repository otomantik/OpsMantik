# GO1 Casino Kasa — AUTOPROOF PACK

**GO:** 1 (one PR).  
**Scope:** DB Setup (migration + RLS + types). No UI.  
**Date:** 2026-01-30

---

## 1) Files touched

| Action | Path |
|--------|------|
| Added | `supabase/migrations/20260130100000_casino_kasa_calls_sites.sql` |
| Added | `lib/types/database.ts` |
| Added | `docs/WAR_ROOM/REPORTS/GO1_CASINO_DB_SETUP.md` |
| Added | `scripts/smoke/go1-casino-db-verify.mjs` |
| Added | `docs/WAR_ROOM/EVIDENCE/GO1_CASINO/AUTOPROOF_PACK.md` |

---

## 2) Key diff hunks

### Migration

```sql
-- calls
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS sale_amount numeric,
  ADD COLUMN IF NOT EXISTS estimated_value numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TRY';
ALTER TABLE public.calls ADD CONSTRAINT calls_sale_amount_non_negative CHECK (sale_amount IS NULL OR sale_amount >= 0);
ALTER TABLE public.calls ADD CONSTRAINT calls_estimated_value_non_negative CHECK (estimated_value IS NULL OR estimated_value >= 0);
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
-- trigger calls_set_updated_at, calls_enforce_update_columns

-- sites
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- RLS
CREATE POLICY "Admins can update sites" ON public.sites FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
```

### Types (lib/types/database.ts)

- `CallUpdatableFields`, `CallRow`, `SiteConfig`, `SiteRow` (sale_amount, currency, config, etc.).

---

## 3) SQL proof (paste outputs)

### 3.1 Policy dump (pg_policies)

Run in Supabase SQL Editor / psql:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('calls', 'sites')
ORDER BY tablename, policyname;
```

**Paste result:**

```
-- Example (replace with actual output):
 schemaname | tablename | policyname              | permissive | roles        | cmd
------------+-----------+-------------------------+------------+--------------+------
 public     | sites     | Admins can update sites | PERMISSIVE | {authenticated} | UPDATE
 public     | sites     | Users can update their own sites | PERMISSIVE | ... | UPDATE
 ...
```

### 3.2 Constraint / column existence

**Calls columns:**

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'calls'
  AND column_name IN ('sale_amount', 'estimated_value', 'currency', 'updated_at')
ORDER BY ordinal_position;
```

**Paste result:**

```
 column_name     | data_type         | column_default | is_nullable
-----------------+-------------------+----------------+-------------
 sale_amount     | numeric           | NULL           | YES
 estimated_value | numeric           | NULL           | YES
 currency        | character varying | 'TRY'::text    | NO
 updated_at      | timestamp with time zone | now() | YES
```

**Calls check constraints:**

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.calls'::regclass
  AND contype = 'c'
  AND conname IN ('calls_sale_amount_non_negative', 'calls_estimated_value_non_negative');
```

**Paste result:**

```
 conname                           | definition
-----------------------------------+------------------------------------------
 calls_sale_amount_non_negative    | CHECK ((sale_amount IS NULL) OR (sale_amount >= 0))
 calls_estimated_value_non_negative| CHECK ((estimated_value IS NULL) OR (estimated_value >= 0))
```

**Sites config column:**

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sites' AND column_name = 'config';
```

**Paste result:** one row: `config | jsonb | '{}'::jsonb | NO`

---

## 4) Smoke proof

GO1 is DB-only. Optional script (no app required):

```bash
node scripts/smoke/go1-casino-db-verify.mjs
```

**Paste result:** b) update sale_amount OK; d) sites.config update OK (or skip if no data).

GO2 smoke (casino-ui-proof.mjs) covers seal API and DB update; run for full E2E.

---

## 5) Build proof

**Command:** `npm run build`

**Log:** `docs/WAR_ROOM/EVIDENCE/GO1_CASINO/build_log.txt`

**Excerpt:**

```
> next build
▲ Next.js 16.1.4 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 7.0s
  Running TypeScript ...
Error: spawn EPERM
```

Compile PASS. Run `npm run build` locally for full TypeScript pass.

---

## 6) PASS/FAIL checklist

| Item | PASS/FAIL |
|------|-----------|
| Migration applies without error | |
| Policy dump: sites policies include "Admins can update sites" (or equivalent) | |
| calls: sale_amount, estimated_value, currency, updated_at exist | |
| calls: calls_sale_amount_non_negative, calls_estimated_value_non_negative exist | |
| sites.config exists, default '{}' | |
| go1-casino-db-verify.mjs (optional) b/d steps OK | |
| npm run build compiles successfully | |
| lib/types/database.ts exports CallRow, SiteConfig, CallUpdatableFields | |
