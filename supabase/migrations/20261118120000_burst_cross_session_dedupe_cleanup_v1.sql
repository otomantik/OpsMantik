BEGIN;

-- One-time-ish cleanup: paired click intents opened as two sessions within a short window,
-- same site + same intent_action + intent_target (typical duplicate visitor burst).
-- Picks deterministic survivor (stronger funnel status → fingerprint signal → older row).
-- Idempotent on re-run once pairs are exhausted.

CREATE OR REPLACE FUNCTION public._lifecycle_weight_click_status(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_status, 'intent')))
    WHEN 'contacted' THEN 500
    WHEN 'offered' THEN 490
    WHEN 'intent' THEN 400
    WHEN 'junk' THEN 250
    ELSE 0
  END;
$$;

DO $$
DECLARE
  v_iter integer := 0;
  v_merged integer := 1;
  v_total bigint := 0;
BEGIN
  WHILE v_merged > 0 AND v_iter < 5000 LOOP
    v_iter := v_iter + 1;

    WITH base AS (
      SELECT
        a.id AS id_a,
        b.id AS id_b,
        a.created_at AS ta,
        b.created_at AS tb,
        public._lifecycle_weight_click_status(a.status) + CASE WHEN nullif(trim(coalesce(a.matched_fingerprint, '')), '') IS NOT NULL THEN 80 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(sa.fingerprint, '')), '') IS NOT NULL THEN 40 ELSE 0 END AS score_a,
        public._lifecycle_weight_click_status(b.status) + CASE WHEN nullif(trim(coalesce(b.matched_fingerprint, '')), '') IS NOT NULL THEN 80 ELSE 0 END +
        CASE WHEN nullif(trim(coalesce(sb.fingerprint, '')), '') IS NOT NULL THEN 40 ELSE 0 END AS score_b
      FROM public.calls a
      INNER JOIN public.calls b
        ON a.site_id = b.site_id
       AND a.id < b.id
      LEFT JOIN public.sessions sa ON sa.id = a.matched_session_id AND sa.site_id = a.site_id
      LEFT JOIN public.sessions sb ON sb.id = b.matched_session_id AND sb.site_id = b.site_id
      WHERE a.source = 'click'
        AND b.source = 'click'
        AND a.merged_into_call_id IS NULL
        AND b.merged_into_call_id IS NULL
        AND a.matched_session_id IS NOT NULL
        AND b.matched_session_id IS NOT NULL
        AND a.matched_session_id IS DISTINCT FROM b.matched_session_id
        AND lower(trim(coalesce(a.intent_action, ''))) IN ('phone', 'whatsapp', 'form')
        AND lower(trim(coalesce(a.intent_action, ''))) = lower(trim(coalesce(b.intent_action, '')))
        AND coalesce(a.intent_target, '') = coalesce(b.intent_target, '')
        AND length(trim(coalesce(a.intent_target, ''))) > 0
        AND lower(coalesce(a.status, 'intent')) NOT IN ('won', 'confirmed', 'cancelled', 'merged')
        AND lower(coalesce(b.status, 'intent')) NOT IN ('won', 'confirmed', 'cancelled', 'merged')
        AND abs(extract(epoch FROM (a.created_at - b.created_at))) <= 5
      ORDER BY least(a.created_at, b.created_at) ASC NULLS LAST, a.id ASC, b.id ASC
      LIMIT 1
    ),
    resolved AS (
      SELECT
        id_a,
        id_b,
        CASE
          WHEN score_a > score_b THEN id_a
          WHEN score_b > score_a THEN id_b
          WHEN ta <= tb THEN id_a
          ELSE id_b
        END AS survivor_id,
        CASE
          WHEN score_a > score_b THEN id_b
          WHEN score_b > score_a THEN id_a
          WHEN ta <= tb THEN id_b
          ELSE id_a
        END AS loser_id,
        ta,
        tb
      FROM base
    ),
    did AS (
      UPDATE public.calls c
      SET
        status = CASE
          WHEN lower(coalesce(c.status, 'intent')) IN ('won', 'confirmed') THEN c.status
          ELSE 'cancelled'
        END,
        merged_into_call_id = r.survivor_id,
        merged_reason = 'burst_cross_session_dedupe_v1',
        note = CASE
          WHEN c.note IS NULL OR btrim(c.note) = '' THEN '[merged_into_burst:' || r.survivor_id::text || ']'
          ELSE c.note || E'\n[merged_into_burst:' || r.survivor_id::text || ']'
        END,
        intent_stamp = 'merged:' || c.id::text
      FROM resolved r
      WHERE c.id = r.loser_id
      RETURNING c.id
    )
    SELECT count(*)::integer INTO v_merged FROM did;

    IF coalesce(v_merged, 0) > 0 THEN
      v_total := v_total + v_merged;
    END IF;

    EXIT WHEN coalesce(v_merged, 0) = 0;
  END LOOP;

  RAISE NOTICE 'burst_cross_session_dedupe_v1 iterations=% merged_total=%', v_iter, v_total;
END $$;

DROP FUNCTION IF EXISTS public._lifecycle_weight_click_status(text);

-- Outbox rows for merged-away calls stop retry churn (worker would keep failing duplicates).
UPDATE public.outbox_events o
SET
  status = 'PROCESSED',
  processed_at = coalesce(o.processed_at, now()),
  last_error = CASE
    WHEN o.last_error IS NULL OR btrim(o.last_error::text) = ''
    THEN 'superseded_burst_cross_session_dedupe_v1'::text
    ELSE o.last_error || E'\n superseded_burst_cross_session_dedupe_v1'
  END,
  updated_at = now()
WHERE o.call_id IN (
    SELECT c.id
    FROM public.calls c
    WHERE c.source = 'click'
      AND c.merged_reason = 'burst_cross_session_dedupe_v1'::text
      AND c.merged_into_call_id IS NOT NULL
  )
  AND o.status IN ('PENDING', 'FAILED', 'PROCESSING');

-- -----------------------------------------------------------------------------
-- Sanity checks (mirror find_or_reuse_session_v1 validations)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_dup_count bigint;
BEGIN
  SELECT count(*)
  INTO v_dup_count
  FROM (
    SELECT c.site_id, c.intent_stamp
    FROM public.calls c
    WHERE lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.intent_stamp IS NOT NULL
      AND c.merged_into_call_id IS NULL
    GROUP BY c.site_id, c.intent_stamp
    HAVING count(*) > 1
  ) d;
  IF coalesce(v_dup_count, 0) > 0 THEN
    RAISE EXCEPTION 'active duplicate intent_stamp validation failed post burst dedupe %', v_dup_count;
  END IF;
END $$;

DO $$
DECLARE
  v_noncanonical bigint;
BEGIN
  SELECT count(*)
  INTO v_noncanonical
  FROM public.calls c
  WHERE lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
    AND c.matched_session_id IS NOT NULL
    AND c.source = 'click'
    AND c.intent_stamp IS DISTINCT FROM ('session:' || c.matched_session_id::text)
    AND c.merged_into_call_id IS NULL;
  IF coalesce(v_noncanonical, 0) > 0 THEN
    RAISE EXCEPTION 'intent_stamp canonicalization validation failed post burst dedupe %', v_noncanonical;
  END IF;
END $$;

DO $$
DECLARE
  v_bad_merged bigint;
BEGIN
  SELECT count(*)
  INTO v_bad_merged
  FROM public.calls c
  WHERE c.merged_into_call_id IS NOT NULL
    AND lower(coalesce(c.status, '')) IN ('intent', 'contacted', 'offered');
  IF coalesce(v_bad_merged, 0) > 0 THEN
    RAISE EXCEPTION 'merged rows still presenting active statuses %', v_bad_merged;
  END IF;
END $$;

DO $$
DECLARE
  v_dup_sessions bigint;
BEGIN
  SELECT count(*)
  INTO v_dup_sessions
  FROM (
    SELECT c.site_id, c.matched_session_id
    FROM public.calls c
    WHERE c.source = 'click'
      AND c.matched_session_id IS NOT NULL
      AND lower(coalesce(c.status, 'intent')) IN ('intent', 'contacted', 'offered')
      AND c.merged_into_call_id IS NULL
    GROUP BY c.site_id, c.matched_session_id
    HAVING count(*) > 1
  ) s;
  IF coalesce(v_dup_sessions, 0) > 0 THEN
    RAISE EXCEPTION 'active_session_single_card_guard validation failed post burst dedupe %', v_dup_sessions;
  END IF;
END $$;

COMMIT;
