# Backfill sessions from first event URL — proof

## Migration filename

**`supabase/migrations/20260130251200_backfill_sessions_utm_from_events_constrained.sql`**

## Key SQL

- **Scope:** GCLID-bearing sessions with null utm_term / utm_campaign / matchtype; restrict to **last 6 months** by `s.created_month >= date_trunc('month', current_date - interval '6 months')::date`.
- **Partition-safe:** Join events by `(e.session_id, e.session_month)` with sessions via `rs.id = e.session_id AND rs.created_month = e.session_month`; only sessions in `recent_sessions` are considered, so no full events scan.
- **First event:** `DISTINCT ON (e.session_id, e.session_month) ... ORDER BY e.session_id, e.session_month, e.created_at ASC` so one row per session = earliest event.
- **Update:** Only fill when null/empty: `COALESCE(NULLIF(trim(s.utm_term), ''), get_url_param(fe.url, 'utm_term'))` (same for utm_campaign, matchtype, utm_source, utm_medium, utm_content).
- **Count:** Migration ends with `SELECT count(*) AS sessions_updated_via_events FROM updated` so the number of sessions updated is returned when the migration runs.

Bulk update (abridged):

```sql
WITH recent_sessions AS (
  SELECT s.id, s.created_month
  FROM public.sessions s
  WHERE s.gclid IS NOT NULL
    AND (s.utm_term IS NULL OR s.utm_campaign IS NULL OR s.matchtype IS NULL)
    AND s.created_month >= date_trunc('month', current_date - interval '6 months')::date
),
first_event AS (
  SELECT DISTINCT ON (e.session_id, e.session_month)
    e.session_id, e.session_month, e.url
  FROM public.events e
  INNER JOIN recent_sessions rs
    ON rs.id = e.session_id AND rs.created_month = e.session_month
  WHERE e.url IS NOT NULL AND e.url LIKE '%?%'
  ORDER BY e.session_id, e.session_month, e.created_at ASC
),
updated AS (
  UPDATE public.sessions s
  SET utm_term = COALESCE(NULLIF(trim(s.utm_term), ''), public.get_url_param(fe.url, 'utm_term')),
      utm_campaign = COALESCE(...), matchtype = COALESCE(...), ...
  FROM first_event fe
  WHERE s.id = fe.session_id AND s.created_month = fe.session_month
  RETURNING s.id
)
SELECT count(*) AS sessions_updated_via_events FROM updated;
```

RPC for smoke: `backfill_one_session_utm_from_events(p_id uuid)` — finds earliest event for that session (same partition join), parses url, updates session only where null/empty.

## SQL counts: sessions updated via event-based backfill

**Before migration (candidates):** sessions with gclid, null UTM, and at least one event with `?` in url (in last 6 months):

```sql
SELECT count(*) AS candidates
FROM public.sessions s
WHERE s.gclid IS NOT NULL
  AND (s.utm_term IS NULL OR s.utm_campaign IS NULL OR s.matchtype IS NULL)
  AND s.created_month >= date_trunc('month', current_date - interval '6 months')::date
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.session_id = s.id AND e.session_month = s.created_month
      AND e.url IS NOT NULL AND e.url LIKE '%?%'
  );
```

**After migration:** the migration’s final `SELECT count(*) AS sessions_updated_via_events FROM updated` is the number of sessions actually updated. Re-run the “candidates” query above after migration; the count should drop (or stay 0) as nulls are filled.

## Smoke script

- **Script:** `scripts/smoke/backfill-events-url-proof.mjs`
- **Run:** `npm run smoke:backfill-events-url`
- **Prerequisite:** Migration `20260130251200_backfill_sessions_utm_from_events_constrained.sql` applied.
- **Behaviour:** Inserts a session (gclid, null utm_term/utm_campaign/matchtype) and an event whose `url` contains `?utm_term=...&utm_campaign=...&matchtype=e`. Calls `backfill_one_session_utm_from_events(session_id)`, then selects the session and asserts utm_term, utm_campaign, matchtype are set.
- **Output:** `PASS (backfill from first event URL fills utm_term, utm_campaign, matchtype)`
