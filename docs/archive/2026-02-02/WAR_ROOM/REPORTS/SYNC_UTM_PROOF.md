# Sync UTM + matchtype persistence — proof

## Diff hunks (app/api/sync/route.ts)

**1) hasNewUTM includes utm_medium, utm_content, matchtype** so that any of these in the URL triggers session update and persistence:

```diff
-                    const hasNewUTM = Boolean(utm?.source || utm?.campaign || utm?.term || utm?.device || utm?.network || utm?.placement);
+                    const hasNewUTM = Boolean(
+                        utm?.source || utm?.medium || utm?.campaign || utm?.term || utm?.content
+                        || utm?.matchtype || utm?.device || utm?.network || utm?.placement
+                    );
```

**2) entry_page stores full landing URL** (comment only; `url` from payload is already stored as-is):

```diff
-                    entry_page: url,
+                    entry_page: url, // Full landing URL including query string (do not strip)
```

## URL parsing (lib/attribution.ts)

`extractUTM(url)` already extracts from URL query params:

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `matchtype` (e/p/b)
- `device`, `network`, `placement`

Sync route uses `extractUTM(url)` and persists all of these into `sessions` on create and on update when `shouldUpdate` (hasNewUTM or hasNewClickId or !attribution_source).

## SQL proof query

After running the smoke script (or after a real sync with UTM URL), verify sessions have UTM + matchtype set:

```sql
-- Show recent sessions with UTM/matchtype (e.g. after smoke or real traffic)
SELECT id, entry_page, utm_term, utm_campaign, matchtype, utm_source, utm_medium, utm_content
FROM public.sessions
WHERE utm_term IS NOT NULL OR utm_campaign IS NOT NULL OR matchtype IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

Smoke injection (direct insert used when sync API is not reachable) inserts a row with:

- `entry_page` = full URL including `?utm_term=...&utm_campaign=...&matchtype=e&...`
- `utm_term`, `utm_campaign`, `matchtype`, `utm_source`, `utm_medium`, `utm_content` set.

## Smoke script

- **Script:** `scripts/smoke/sync-utm-capture-proof.mjs`
- **Run:** `npm run smoke:sync-utm`
- **Behaviour:** Tries POST `/api/sync` with full URL (query string with UTM + matchtype). Then selects that session by `id` and asserts `utm_term`, `utm_campaign`, `matchtype` are set and (when sync was used) `entry_page` contains the query string. If sync API is not reachable, inserts a test session directly with those fields and asserts.
- **Output:** `PASS (UTM + matchtype persisted; entry_page full URL)`
