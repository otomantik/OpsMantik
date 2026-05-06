-- Identity integrity health (read-only)
-- Tracks caller_phone_hash_sha256 consistency on won/sealed export candidates.

WITH candidates AS (
  SELECT
    c.site_id,
    c.id AS call_id,
    c.caller_phone_e164,
    c.caller_phone_hash_sha256,
    c.status,
    c.oci_status,
    c.confirmed_at
  FROM public.calls c
  WHERE (c.status = 'won' OR c.oci_status = 'sealed')
),
agg AS (
  SELECT
    c.site_id,
    COUNT(*) FILTER (
      WHERE c.caller_phone_hash_sha256 IS NOT NULL
        AND c.caller_phone_hash_sha256 !~ '^[0-9a-f]{64}$'
    )::int AS malformed_phone_hash_count,
    COUNT(*) FILTER (
      WHERE c.caller_phone_e164 IS NOT NULL
        AND c.caller_phone_hash_sha256 IS NULL
    )::int AS missing_phone_hash_count_where_expected
  FROM candidates c
  GROUP BY c.site_id
),
samples AS (
  SELECT
    c.site_id,
    c.call_id,
    c.caller_phone_e164,
    c.caller_phone_hash_sha256,
    c.confirmed_at
  FROM candidates c
  WHERE (c.caller_phone_hash_sha256 IS NOT NULL AND c.caller_phone_hash_sha256 !~ '^[0-9a-f]{64}$')
     OR (c.caller_phone_e164 IS NOT NULL AND c.caller_phone_hash_sha256 IS NULL)
  ORDER BY c.confirmed_at DESC NULLS LAST
  LIMIT 50
)
SELECT
  s.id AS site_id,
  s.name AS site_name,
  COALESCE(a.malformed_phone_hash_count, 0) AS malformed_phone_hash_count,
  COALESCE(a.missing_phone_hash_count_where_expected, 0) AS missing_phone_hash_count_where_expected
FROM public.sites s
LEFT JOIN agg a
  ON a.site_id = s.id
ORDER BY malformed_phone_hash_count DESC, missing_phone_hash_count_where_expected DESC, s.name ASC;

-- Sample rows for deterministic verification / repair queue triage.
SELECT
  site_id,
  call_id,
  caller_phone_e164,
  caller_phone_hash_sha256,
  confirmed_at
FROM samples
ORDER BY confirmed_at DESC NULLS LAST;
