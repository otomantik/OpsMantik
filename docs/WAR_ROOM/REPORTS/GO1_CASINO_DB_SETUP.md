# GO1 — Casino Kasa DB Setup

**Date:** 2026-01-30  
**Scope:** Sales/Bounty foundation (calls + sites). No UI changes.

---

## 1. New columns

### public.calls

| Column            | Type      | Nullable | Default | Constraint |
|-------------------|-----------|----------|---------|------------|
| `sale_amount`     | numeric   | yes      | —       | `>= 0`     |
| `estimated_value` | numeric   | yes      | —       | `>= 0`     |
| `currency`        | text      | no       | `'TRY'` | —          |
| `updated_at`      | timestamptz | yes    | now()   | set by trigger on UPDATE |

- **sale_amount:** Actual sale amount (Casino Kasa / bounty).
- **estimated_value:** Estimated value for bounty chip.
- **currency:** Currency code (e.g. TRY).
- **updated_at:** Set automatically on UPDATE via `calls_set_updated_at` trigger.

Constraints: `calls_sale_amount_non_negative`, `calls_estimated_value_non_negative`.

### public.sites

| Column   | Type  | Nullable | Default   |
|----------|-------|----------|-----------|
| `config` | jsonb | no       | `'{}'`    |

- **config:** Per-site config: bounty chip values, UI knobs. UI reads chip values from `sites.config->'bounty_chips'` (or equivalent).

---

## 2. RLS decisions

### calls

- **Existing:** Tenant isolation (Iron Dome) allows SELECT/INSERT/UPDATE/DELETE for site owners/editors/admins.
- **New:** Trigger `calls_enforce_update_columns` restricts **which columns** can be updated by non–service_role:
  - **Allowed:** `sale_amount`, `estimated_value`, `currency`, `status`, `confirmed_at`, `confirmed_by`, `note`, `lead_score`, `oci_status`, `oci_status_updated_at` (and `updated_at` by trigger).
  - **Forbidden:** `id`, `site_id`, `phone_number`, `matched_session_id`, `matched_fingerprint`, `created_at`, `intent_page_url`, `click_id`, `source`, `intent_*`, `oci_uploaded_at`, `oci_matched_at`, `oci_batch_id`, `oci_error`.
- Full-row updates are not allowed for authenticated users; only the allowed fields above.

### sites

- **Existing:** "Users can update their own sites" (owner only).
- **New:** Policy "Admins can update sites" — `USING (public.is_admin())`, `WITH CHECK (public.is_admin())`. So owners and admins can UPDATE sites (e.g. `config`).

---

## 3. How UI reads chip values

- **Source:** `public.sites.config` (jsonb).
- **Shape:** e.g. `{ "bounty_chips": { "low": 100, "medium": 250, "high": 500 }, "currency": "TRY" }`.
- **Read:** Fetch site row (or use existing site context), then `site.config.bounty_chips`, `site.config.currency`. No new API in this GO; UI will use existing site fetch + `config` when building bounty/Casino Kasa UI.

---

## 4. Migration file

- `supabase/migrations/20260130100000_casino_kasa_calls_sites.sql`

---

## 5. TypeScript types

- **Location:** `lib/types/database.ts`
- **Exports:** `CallUpdatableFields`, `CallRow`, `SiteConfig`, `SiteRow`
- **Generated types:** If you use `supabase gen types`, run and commit:
  - `npx supabase gen types typescript --project-id <ref> > lib/types/database.types.ts`
