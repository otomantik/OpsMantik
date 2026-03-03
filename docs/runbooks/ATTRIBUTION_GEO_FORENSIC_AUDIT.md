# High-Precision Attribution & Geo-Targeting Forensic Audit

**Role:** Principal Distributed Systems Architect & Data Integrity Lead  
**Scope:** `lib/attribution.ts`, `lib/services/session-service.ts`, `lib/types/ingest.ts`, `lib/geo/upsert-session-geo.ts`, `lib/ingest/process-sync-event.ts`, migrations `20260130250500`, `20260221100000`

---

## 1. REGEX & PARSER SANITIZATION (The "Silent Null" Trap)

### 1.1 URL-Encoded vs. Raw Characters in `{keyword}`

`extractUTM` uses `URLSearchParams`, which **automatically decodes** `%20`, `%26`, etc. So `utm_term=foo%20bar` → `term = "foo bar"`. No explicit decode step; `URLSearchParams.get()` returns the decoded string.

**Edge Case – Literal "null"/"undefined":**

```typescript
// lib/attribution.ts L167-172
return {
  term: term || undefined,   // "null" (string) is truthy → stored as "null"
  ...
};
```

- `params.get('utm_term')` returns the raw value. If Google sends `utm_term=null`, we get the string `"null"`.
- `"null" || undefined` → `"null"` (truthy).
- **Result:** The literal string `"null"` is stored in `sessions.utm_term` instead of SQL `NULL` → silent contamination.

**Same behavior for:** `undefined`, `{}`, `[]` when sent as query values.

### 1.2 `keyword={lpurl}` Edge Case

If the tracking template uses `keyword={lpurl}`, ValueTrack replaces it with the final URL. We receive a full URL as `utm_term` and store it. No special handling. If a bug sends the literal `"{lpurl}"`, that string would also be stored.

### 1.3 DSA (Dynamic Search Ads) Fallback

For DSA, `{keyword}` is empty. There is **no fallback** to `ads_placement` or `utm_content` to infer targeting. We store exactly what we receive:

- `utm_term` → NULL or empty
- `ads_placement` → Display URL (e.g. `example.com/page`)
- `utm_content` → Creative variant

**Gap:** No DSA-specific logic to derive a surrogate "targeting" value from `ads_placement` or `utm_content` for reporting.

---

## 2. GEO-TARGETING FIDELITY (ADS vs. IP)

### 2.1 Conflict Resolution in `upsert-session-geo`

- **ADS:** Always writes `geo_city`, `geo_district`, `geo_source='ADS'`.
- **IP:** Only if `geo_source != 'ADS'`; Rome/Amsterdam → `UNKNOWN`, city/district set to NULL.
- **Order:** ADS overwrites IP; IP never overwrites ADS.

### 2.2 Database Mapping

- `sessions.loc_physical_ms` stores the raw criteria ID string (e.g. `"1012782"`).
- `google_geo_targets.criteria_id` is `bigint` PK.
- **Resolution:** In `process-sync-event.ts` L305–323:

```typescript
const geoCriteriaId = utm?.loc_physical_ms || utm?.loc_interest_ms;
if (currentGclid && geoCriteriaId) {
  const id = parseInt(String(geoCriteriaId), 10);
  const { data: geoRow } = await adminClient
    .from('google_geo_targets')
    .select('canonical_name')
    .eq('criteria_id', id)
    .single();
  // ... upsertSessionGeo({ city, district, source: 'ADS' })
}
```

Join is explicit in application code; no DB FK. Resolution only when **both** `currentGclid` and `geoCriteriaId` exist.

### 2.3 loc_interest_ms vs. loc_physical_ms

- `loc_physical_ms` = user’s physical location.
- `loc_interest_ms` = targeting (location of interest).

Precedence: `loc_physical_ms || loc_interest_ms`. Physical location wins, so out-of-region leads are not misattributed as local.

---

## 3. SESSION PERSISTENCE (The "Attribution Leak")

### 3.1 Call–Session Bridge

- **Sync flow:** Session ID (`sid`) from cookie; if not found → new session.
- **Call-event:** Uses `findRecentSessionByFingerprint` → events by `metadata->>fingerprint` → most recent event’s `session_id` → session.

Bridge: fingerprint → events → session.

### 3.2 Cookie Expiry / New Session Risk

If the cookie is cleared after landing but before later page views:

1. Landing (sync): Session A created with GCLID, event with fingerprint.
2. Cookie cleared.
3. Later page views: New `sid` → SessionService does not find A by `client_sid` → new sessions B, C, D…
4. Events on pages 2–5 stored under B, C, D (no GCLID).
5. Call-event: `findRecentSessionByFingerprint` returns the **most recent** event → Session D (or last page).
6. Session D has no GCLID.

**Critical blind spot:** Call can be matched to a session without GCLID, even when the original landing had GCLID.

### 3.3 Attribution Overwrite in `updateSessionIfNecessary`

```typescript
// session-service.ts L141-142
updates.attribution_source = attributionSource;  // ALWAYS overwrites
```

`attributionSource` is computed from the **current** request. For a later heartbeat/page view with no GCLID in URL:

- Current request → `attributionSource = "Organic"`.
- Existing session had `attribution_source = "First Click (Paid)"`.
- Update overwrites with `"Organic"`.

**First-click protection is broken:** Multi-touch updates can downgrade a Paid session to Organic.

---

## 4. TECHNICAL DEBT & SCHEMA ALIGNMENT

### 4.1 Type Safety

- `sessions.gclid`, `wbraid`, `gbraid` → `TEXT` in initial schema.
- No truncation risk; longer IDs are safe.

### 4.2 Index Optimization

| Index | Exists | Notes |
|-------|--------|-------|
| `idx_calls_matched_session` | ✅ | Call→session lookups |
| `idx_sessions_site_fingerprint` | ✅ | Fingerprint matching |
| `idx_sessions_loc_physical_ms` | ❌ | Not created |
| `idx_sessions_utm_adgroup` | ✅ | UTM queries |

`loc_physical_ms` is used in application logic (from `utm`), not in session lookups during Seal. The Seal path uses `matched_session_id` → session, which is covered. Index on `loc_physical_ms` would only help geo analytics, not Seal latency.

---

## 5. CRITICAL BLIND SPOTS (Summary)

| # | Scenario | Impact |
|---|----------|--------|
| 1 | Literal `"null"` / `"undefined"` in `utm_term` stored as string | DB contamination, analytics noise |
| 2 | `attribution_source` overwritten on every update | Paid sessions downgraded to Organic |
| 3 | Cookie expiry → new sessions → call matched to session without GCLID | OCI conversion loss |
| 4 | DSA: no fallback for empty `{keyword}` | Missing keyword-level reporting for DSA |
| 5 | `{lpurl}` or malformed template values stored as-is | Invalid strings in `utm_term` |

---

## 6. REFINED SQL HEALTH-CHECK

**Attribution Enrichment Rate:** Share of sessions with GCLID and full meta.

```sql
-- Attribution Enrichment Rate (Sessions with GCLID + Full Meta / Total Sessions)
WITH enriched AS (
  SELECT COUNT(*) AS cnt
  FROM sessions s
  WHERE s.site_id = $1
    AND s.created_at >= $2
    AND s.created_at < $3
    AND COALESCE(NULLIF(TRIM(s.gclid), ''), NULL) IS NOT NULL
    AND s.utm_source IS NOT NULL
    AND s.utm_medium IS NOT NULL
    AND s.utm_campaign IS NOT NULL
    AND s.utm_term IS NOT NULL
    AND s.matchtype IS NOT NULL
),
total AS (
  SELECT COUNT(*) AS cnt
  FROM sessions s
  WHERE s.site_id = $1
    AND s.created_at >= $2
    AND s.created_at < $3
)
SELECT
  total.cnt AS total_sessions,
  enriched.cnt AS enriched_sessions,
  ROUND(100.0 * enriched.cnt / NULLIF(total.cnt, 0), 2) AS enrichment_rate_pct
FROM total, enriched;
```

---

## 7. HARDENING RECOMMENDATIONS

### 7.1 `lib/attribution.ts` – Null/String Sanitization

```typescript
const SENTINEL_VALUES = new Set(['null', 'undefined', '{}', '[]', '']);

function sanitizeParam(value: string | null): string | undefined {
  if (value == null || value === '') return undefined;
  const t = value.trim();
  if (!t || SENTINEL_VALUES.has(t.toLowerCase())) return undefined;
  return t;
}

// In extractUTM return block:
term: sanitizeParam(term ?? null) ?? undefined,
// ... apply to all string params
```

### 7.2 `lib/attribution.ts` – DSA Fallback (Optional)

```typescript
// When term is empty but ads_placement or utm_content present, use as DSA surrogate
const effectiveTerm = term && term.trim()
  ? term.trim()
  : (content?.trim() || placement?.trim() || undefined);
```

### 7.3 `lib/attribution.ts` – Referrer-Based Fallback

```typescript
// In computeAttribution: when gclid absent but referrer is google and utm indicates paid
if (!gclid && referrer && /google|googleads/i.test(referrer)) {
  if (utm?.medium && ['cpc','ppc','paid'].includes(utm.medium.toLowerCase())) {
    return { source: 'Paid (UTM + Referrer)', isPaid: true };
  }
}
```

### 7.4 `lib/services/session-service.ts` – First-Click Protection

```typescript
// In updateSessionIfNecessary: do NOT overwrite high-value attribution with lower
const isHigherValue = (a: string, b: string) => {
  const order = ['First Click (Paid)', 'Paid (UTM)', 'Ads Assisted', 'Paid Social', 'Organic'];
  return order.indexOf(a) < order.indexOf(b);
};
if (session.attribution_source && isHigherValue(session.attribution_source, attributionSource)) {
  delete updates.attribution_source; // Preserve existing
}
```

### 7.5 Call-Event Match Preference for GCLID Session

In `findRecentSessionByFingerprint`: when multiple candidate sessions exist for the same fingerprint, prefer the session with GCLID over the most recent session without GCLID (e.g. extend query to return all matching sessions and rank by `hasClickId` first, then `created_at`).

---

*Audit completed. Recommendations are backward-compatible and can be applied incrementally.*
