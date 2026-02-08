# RUNBOOK — Attribution Dead (gclidLast3Hours = 0)

## Scope

Production only. Signal: sessions with `gclid` (or wbraid/gbraid) not being ingested / classified.

## Symptoms

- Watchtower reports `gclidLast3Hours.count = 0` (alarm).
- Dashboard Ads metrics drop to zero while sessions still exist.
- Customers report “Google Ads not showing”.

## Immediate checks (5 minutes)

1. **Confirm sessions exist**

```sql
SELECT COUNT(*)::int AS sessions_last_3h
FROM public.sessions
WHERE created_at >= NOW() - INTERVAL '3 hours';
```

If `0`, this is actually an ingestion outage → use `RUNBOOK_NO_SESSIONS.md`.

2. **Confirm gclid truly missing**

```sql
SELECT COUNT(*)::int AS gclid_sessions_last_3h
FROM public.sessions
WHERE created_at >= NOW() - INTERVAL '3 hours'
  AND gclid IS NOT NULL;
```

Expected:
- If `0`, proceed.

3. **Vercel logs**
- `/api/sync` 2xx rate normal?
- Any recent deploy around the drop?

4. **Sentry**
- Search for errors in URL parsing / ingest normalization in:
  - `/api/sync`
  - `/api/sync/worker`

## Root-cause triage (most common)

### A) Landing URL lost query params (redirect stripping)
If customer ads click lands on a URL that redirects and drops `?gclid=...`, attribution will be lost.

How to confirm (prod safe):
- Ask customer for the **final landing URL** after click.
- Validate it still contains `gclid`, `wbraid`, or `gbraid`.

### B) Tracker not sending full URL (first event)
Attribution is derived from the **first-touch URL**.

How to confirm:
- Use `/api/sync?diag=1` (does not reveal IP) to confirm headers and chosen geo.
- Check ingest logs for `sync_producer.url` context in Sentry (truncated to 200 chars in code).

### C) Ads traffic genuinely stopped
If customer paused campaigns, gclid count can drop to zero while organic sessions continue.

Confirm with customer:
- campaign spend/impressions for the last 3 hours

## Commands to run

### A) Sample recent sessions (sanity)

```sql
SELECT created_at, site_id, gclid, wbraid, gbraid, traffic_source, url
FROM public.sessions
WHERE created_at >= NOW() - INTERVAL '6 hours'
ORDER BY created_at DESC
LIMIT 50;
```

Expected:
- For Ads traffic you should see at least one of `gclid/wbraid/gbraid`.

### B) Site-scoped check (if one customer)

```sql
SELECT created_at, gclid, traffic_source, url
FROM public.sessions
WHERE site_id = '<SITE_UUID>'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 200;
```

Expected:
- Find the last time gclid appeared and correlate to deploy or customer change.

## Mitigation

- If redirect stripping: fix on customer side (preserve query string).
- If tracker stripping: update customer embed to latest core.js; ensure it sends `window.location.href` including query.
- If classification logic regression: roll back deploy; then patch.

## Rollback

- Vercel rollback to last good deploy if drop correlates with deploy SHA.
- If env change caused issue (proxy stripping URL): revert and redeploy.

## Proof / Acceptance checklist

- [ ] `gclid_sessions_last_3h > 0` (or wbraid/gbraid equivalents) after fix.
- [ ] Dashboard Ads breakdown shows non-zero again.
- [ ] A real ad click produces a session row with click id present.
- [ ] Watchtower shows `gclidLast3Hours.status = ok`.

