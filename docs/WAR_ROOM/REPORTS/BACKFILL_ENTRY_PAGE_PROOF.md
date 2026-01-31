# Backfill sessions.utm_term, utm_campaign, matchtype from entry_page — proof

## Migration filename

**`supabase/migrations/20260130251100_backfill_sessions_utm_entry_page_null_empty.sql`**

- Backfills **utm_term**, **utm_campaign**, **matchtype** from `entry_page` query string for sessions with `gclid IS NOT NULL` and `entry_page LIKE '%?%'`.
- **Only fills when target column is null or empty:**  
  `COALESCE(NULLIF(trim(utm_term), ''), get_url_param(entry_page, 'utm_term'))` (same for utm_campaign, matchtype).
- **Partition-safe:** `UPDATE public.sessions` runs against the parent table; PostgreSQL routes to the correct partition(s).
- Depends on `public.get_url_param` from `20260130250700_backfill_sessions_utm_from_entry_page.sql`.
- Also defines **`backfill_one_session_utm_from_entry_page(p_id uuid)`** for smoke/test (same COALESCE logic for one row).

## SQL sample: counts before/after

Run **before** applying the migration (or on a copy):

```sql
-- Before: GCLID sessions with entry_page query string but utm_term/campaign/matchtype null/empty
SELECT
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(utm_term, '')) = '')) AS missing_utm_term,
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(utm_campaign, '')) = '')) AS missing_utm_campaign,
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(matchtype, '')) = '')) AS missing_matchtype
FROM public.sessions;
```

Run **after** applying the migration:

```sql
-- After: same counts (should be 0 or lower if backfill filled null/empty from entry_page)
SELECT
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(utm_term, '')) = '')) AS missing_utm_term,
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(utm_campaign, '')) = '')) AS missing_utm_campaign,
  count(*) FILTER (WHERE gclid IS NOT NULL AND entry_page LIKE '%?%' AND (trim(COALESCE(matchtype, '')) = '')) AS missing_matchtype
FROM public.sessions;
```

Example output (sample):

| missing_utm_term | missing_utm_campaign | missing_matchtype |
|------------------|----------------------|-------------------|
| Before: 42       | 42                   | 42                |
| After:  0        | 0                    | 0                 |

(Exact numbers depend on data; after backfill, counts for “missing” should not increase and may decrease.)

## Smoke script

- **Script:** `scripts/smoke/backfill-entry-page-proof.mjs`
- **Run:** `npm run smoke:backfill-entry-page`
- **Prerequisite:** Migration `20260130251100_backfill_sessions_utm_entry_page_null_empty.sql` must be applied first (`supabase db push` or `supabase migration up`). If the RPC is missing, the script exits with a clear message.
- **Behaviour:** Inserts a session with `gclid`, `entry_page` containing `?utm_term=...&utm_campaign=...&matchtype=e`, and `utm_term`/`utm_campaign`/`matchtype` null. Calls `backfill_one_session_utm_from_entry_page(session_id)`, then asserts the row has utm_term, utm_campaign, matchtype set.
- **Output:** `PASS (backfill from entry_page fills utm_term, utm_campaign, matchtype when null/empty)`
