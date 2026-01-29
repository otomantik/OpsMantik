# EXECUTION PHASE 1 — SECTOR ALPHA: STATUS REPORT

**Mission:** Hunter Database Upgrade (AI columns, events.site_id, processed_signals ledger, auto-partitions).  
**Date:** 2026-01-29  
**Next:** SECTOR BRAVO (Store & Forward in ux-core.js).

---

## 1. Did the SQL run?

**Instructions:** Run the migration in Supabase SQL Editor (or via CLI).

- **Option A — Supabase SQL Editor:**  
  Open **Supabase Dashboard → SQL Editor**. Paste and run the contents of:
  - `supabase/migrations/20260129100000_hunter_db_phase1.sql`  
  (Run in one go, or in order: 1.1 → 1.2 → 1.3.)

- **Option B — CLI:**  
  `supabase db push`  
  (Applies all pending migrations including this one.)

**Checklist after run:**

| Step | What ran | How to verify |
|------|----------|----------------|
| 1.1 | sessions: ai_score, ai_summary, ai_tags, user_journey_path; events: site_id + index | `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name LIKE 'ai%';` — should show ai_score, ai_summary, ai_tags, user_journey_path. Same for events.site_id. |
| 1.2 | processed_signals table + indexes | `SELECT * FROM information_schema.tables WHERE table_schema='public' AND table_name='processed_signals';` — one row. |
| 1.3 | create_next_month_partitions() + optional cron | `SELECT public.create_next_month_partitions();` — runs without error; check NOTICE for "Created partition" or "already exists". |

**Status:**  
- [ ] **No red text** → SQL ran successfully.  
- [ ] **Red text / error** → Note the error (e.g. permission, extension) and fix before SECTOR BRAVO.

---

## 2. Is pg_cron active (or do we need the Edge Function backup plan)?

**How to check:**

1. **Supabase Dashboard → Database → Extensions**  
   - If **pg_cron** is listed and can be enabled → enable it, then re-run only the final `DO $$ ... END; $$` block from the migration (the part that runs `cron.schedule`), or run:
   ```sql
   SELECT cron.schedule('maintain-partitions', '0 3 * * *', 'SELECT public.create_next_month_partitions()');
   ```

2. **If pg_cron is not available (e.g. Free Tier):**  
   - The migration is written so the **cron.schedule** step is skipped safely (NOTICE only, no failure).  
   - You **must** use the **Edge Function backup plan**: schedule a Supabase Edge Function (or external cron) to run **at least once per month** (e.g. 1st of month 00:05):
   ```text
   POST /functions/v1/your-function-name
   ```
   That function should call the Supabase client (service role) and run:
   ```sql
   SELECT public.create_next_month_partitions();
   ```
   (e.g. via `supabase.rpc('create_next_month_partitions')` or a raw SQL call if your stack supports it.)

**Status:**

- [ ] **pg_cron active** → Schedule is set; next month’s partitions will be created automatically (e.g. daily at 03:00).
- [ ] **pg_cron not available** → Edge Function (or external cron) backup required; run `create_next_month_partitions()` at least once per month.

---

## 3. API change (already applied)

The Sync API now populates **events.site_id** on every event insert (`site_id: site.id`). Realtime listeners can filter with `filter: site_id=eq.<siteId>` for faster, site-scoped streams.

---

## 4. Next step: SECTOR BRAVO

Once this status is confirmed (SQL run, pg_cron or backup plan clear), we move to **SECTOR BRAVO**: rewrite **ux-core.js** to use the **Store & Forward** queue and stop using sendBeacon blindly, leveraging the **processed_signals** ledger for Zero-Loss.

**REPORT STATUS:**  
1. Did the SQL run? *(Yes / No — if No, note error.)*  
2. Is pg_cron active, or is the Edge Function backup plan in place? *(pg_cron active / Backup plan)*
