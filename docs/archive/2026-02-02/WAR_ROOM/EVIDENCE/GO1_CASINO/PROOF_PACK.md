# GO1 Casino Kasa — Proof Pack

**Date:** 2026-01-30  
**Scope:** DB Setup (migration + RLS + types + docs). No UI.

---

## 1. Files touched

| Action   | Path |
|----------|------|
| Added    | `supabase/migrations/20260130100000_casino_kasa_calls_sites.sql` |
| Added    | `lib/types/database.ts` |
| Added    | `docs/WAR_ROOM/REPORTS/GO1_CASINO_DB_SETUP.md` |
| Added    | `scripts/smoke/go1-casino-db-verify.mjs` |
| Added    | `docs/WAR_ROOM/EVIDENCE/GO1_CASINO/PROOF_PACK.md` |

---

## 2. Key diff hunks

### Migration (columns + constraints + triggers + RLS)

```sql
-- calls
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS sale_amount numeric,
  ADD COLUMN IF NOT EXISTS estimated_value numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'TRY';
ALTER TABLE public.calls ADD CONSTRAINT calls_sale_amount_non_negative CHECK (sale_amount IS NULL OR sale_amount >= 0);
ALTER TABLE public.calls ADD CONSTRAINT calls_estimated_value_non_negative CHECK (estimated_value IS NULL OR estimated_value >= 0);
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
-- trigger calls_set_updated_at BEFORE UPDATE
-- trigger calls_enforce_update_columns BEFORE UPDATE (reject non-allowed column changes for non-service_role)

-- sites
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- RLS
CREATE POLICY "Admins can update sites" ON public.sites FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
```

### Policy (sites)

- **Admins can update sites:** `USING (public.is_admin())`, `WITH CHECK (public.is_admin())`.

---

## 3. SQL verification queries + outputs

Run after applying the migration (Supabase SQL Editor or `psql`).

### a) Column existence: calls

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'calls'
  AND column_name IN ('sale_amount', 'estimated_value', 'currency', 'updated_at')
ORDER BY ordinal_position;
```

**Expected (paste result):**

| column_name     | data_type         | column_default | is_nullable |
|-----------------|-------------------|----------------|-------------|
| sale_amount     | numeric           | NULL           | YES         |
| estimated_value | numeric           | NULL           | YES         |
| currency        | character varying | 'TRY'::text    | NO          |
| updated_at      | timestamp with time zone | now()  | YES         |

### a) Column existence: sites

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sites' AND column_name = 'config';
```

**Expected:** one row: `config | jsonb | '{}'::jsonb | NO`

---

### b) Update sale_amount (as authenticated or service_role)

- **Option A (service_role):** From app or script: `supabase.from('calls').update({ sale_amount: 100, currency: 'TRY' }).eq('id', '<call_id>').select().single()` → expect success.
- **Option B (authenticated):** From UI or API that uses anon key + auth: update a call’s `sale_amount` for a site the user owns → expect success.

**Paste result:** e.g. `Updated: { id: '...', sale_amount: 100, currency: 'TRY' }`

---

### c) Constraints reject negative values

```sql
-- Pick an existing call id
UPDATE public.calls SET sale_amount = -1 WHERE id = (SELECT id FROM public.calls LIMIT 1);
```

**Expected:** `ERROR: new row violates check constraint "calls_sale_amount_non_negative"`

```sql
UPDATE public.calls SET estimated_value = -10 WHERE id = (SELECT id FROM public.calls LIMIT 1);
```

**Expected:** `ERROR: new row violates check constraint "calls_estimated_value_non_negative"`

**Paste result:** (error messages above)

---

### d) sites.config default and update by owner/admin

```sql
SELECT id, config FROM public.sites LIMIT 1;
```

**Expected:** `config` is `{}` or existing json.

```sql
UPDATE public.sites SET config = '{"bounty_chips":{"low":100},"currency":"TRY"}'::jsonb WHERE id = (SELECT id FROM public.sites LIMIT 1);
SELECT id, config FROM public.sites LIMIT 1;
```

**Expected:** No error; `config` shows the updated json. (Run as owner or admin; RLS allows.)

**Paste result:** (one row with updated config)

---

## 4. Build

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

**Note:** Compile PASS (7.0s). TypeScript step hit EPERM in this environment. Run `npm run build` locally for full build.

---

## 5. PASS/FAIL checklist

| Item | PASS/FAIL |
|------|-----------|
| Migration applies without error | |
| a) calls columns exist (sale_amount, estimated_value, currency, updated_at) | |
| a) sites.config exists, default '{}' | |
| b) Update call sale_amount (service_role or authenticated) succeeds | |
| c) UPDATE sale_amount = -1 fails with check constraint | |
| c) UPDATE estimated_value = -10 fails with check constraint | |
| d) sites.config select shows {} or json; update by owner/admin succeeds | |
| npm run build compiles successfully | |
| lib/types/database.ts exports CallRow, SiteConfig, CallUpdatableFields | |
