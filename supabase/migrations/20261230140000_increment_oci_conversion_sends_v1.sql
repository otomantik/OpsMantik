-- PR: Billing idempotency — conversion_sends debited once per offline_conversion_queue row (ledger),
-- never per HTTP retry. Node calls only public.increment_oci_conversion_sends_v1 (service_role).

BEGIN;

ALTER TABLE public.usage_counters
  ADD COLUMN IF NOT EXISTS conversion_sends_count bigint NOT NULL DEFAULT 0
  CHECK (conversion_sends_count >= 0);

CREATE TABLE IF NOT EXISTS public.oci_conversion_send_billing_ledger (
  queue_id uuid NOT NULL,
  site_id uuid NOT NULL,
  usage_month date NOT NULL,
  billed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oci_conversion_send_billing_ledger_pkey PRIMARY KEY (queue_id),
  CONSTRAINT oci_conversion_send_billing_ledger_queue_fk
    FOREIGN KEY (queue_id) REFERENCES public.offline_conversion_queue (id) ON DELETE RESTRICT,
  CONSTRAINT oci_conversion_send_billing_ledger_site_fk
    FOREIGN KEY (site_id) REFERENCES public.sites (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oci_conversion_send_billing_ledger_site_month_idx
  ON public.oci_conversion_send_billing_ledger (site_id, usage_month);

COMMENT ON TABLE public.oci_conversion_send_billing_ledger IS
  'Financial idempotency: at most one conversion_sends debit per queue_id (lifetime). '
  'Inserts use ON CONFLICT DO NOTHING; usage_counters.conversion_sends_count increases only by newly inserted rows.';

ALTER TABLE public.oci_conversion_send_billing_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.oci_conversion_send_billing_ledger FROM PUBLIC;
REVOKE ALL ON TABLE public.oci_conversion_send_billing_ledger FROM anon;
REVOKE ALL ON TABLE public.oci_conversion_send_billing_ledger FROM authenticated;

DROP POLICY IF EXISTS oci_conversion_send_billing_ledger_service_all ON public.oci_conversion_send_billing_ledger;
CREATE POLICY oci_conversion_send_billing_ledger_service_all
  ON public.oci_conversion_send_billing_ledger
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.oci_conversion_send_billing_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.increment_oci_conversion_sends_v1(
  p_site_id uuid,
  p_month date,
  p_queue_ids uuid[],
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_distinct_count integer := 0;
  v_owned_count integer := 0;
  v_unbilled_count integer := 0;
  v_inserted integer := 0;
  v_row public.usage_counters%ROWTYPE;
  v_current bigint := 0;
  v_after bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'access_denied',
      DETAIL = 'increment_oci_conversion_sends_v1 may only be called by service_role',
      ERRCODE = 'P0001';
  END IF;

  IF p_site_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'p_site_id_required');
  END IF;

  IF p_queue_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'p_queue_ids_required');
  END IF;

  SELECT count(*)::integer
  INTO v_distinct_count
  FROM (
    SELECT DISTINCT x AS queue_id
    FROM unnest(p_queue_ids) AS u(x)
    WHERE x IS NOT NULL
  ) d;

  IF v_distinct_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'billed_new', 0,
      'billed_already', 0,
      'delta_applied', 0,
      'new_count', null,
      'reason', null
    );
  END IF;

  SELECT count(*)::integer
  INTO v_owned_count
  FROM (
    SELECT DISTINCT u.x AS queue_id
    FROM unnest(p_queue_ids) AS u(x)
    WHERE u.x IS NOT NULL
  ) ids
  INNER JOIN public.offline_conversion_queue q ON q.id = ids.queue_id AND q.site_id = p_site_id;

  IF v_owned_count <> v_distinct_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'QUEUE_SITE_MISMATCH',
      'distinct_input', v_distinct_count,
      'owned_match', v_owned_count
    );
  END IF;

  INSERT INTO public.usage_counters (site_id, month)
  VALUES (p_site_id, v_month)
  ON CONFLICT (site_id, month) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.usage_counters
  WHERE site_id = p_site_id
    AND month = v_month
  FOR UPDATE;

  v_current := COALESCE(v_row.conversion_sends_count, 0);

  -- Rows not yet in the lifetime ledger (under usage_counters lock for this site+month).
  SELECT count(*)::integer
  INTO v_unbilled_count
  FROM (
    SELECT i.queue_id
    FROM (
      SELECT DISTINCT u.x AS queue_id
      FROM unnest(p_queue_ids) AS u(x)
      WHERE u.x IS NOT NULL
    ) i
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.oci_conversion_send_billing_ledger l
      WHERE l.queue_id = i.queue_id
    )
  ) new_only;

  IF p_limit >= 0 AND (v_current + v_unbilled_count) > p_limit THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'LIMIT',
      'current', v_current,
      'requested_new', v_unbilled_count,
      'limit', p_limit,
      'month', v_month
    );
  END IF;

  WITH ids AS (
    SELECT DISTINCT u.x AS queue_id
    FROM unnest(p_queue_ids) AS u(x)
    WHERE u.x IS NOT NULL
  ),
  new_ids AS (
    SELECT ids.queue_id
    FROM ids
    WHERE NOT EXISTS (
      SELECT 1 FROM public.oci_conversion_send_billing_ledger l WHERE l.queue_id = ids.queue_id
    )
  ),
  ins AS (
    INSERT INTO public.oci_conversion_send_billing_ledger (queue_id, site_id, usage_month)
    SELECT new_ids.queue_id, p_site_id, v_month
    FROM new_ids
    ON CONFLICT (queue_id) DO NOTHING
    RETURNING queue_id
  )
  SELECT count(*)::integer INTO v_inserted FROM ins;

  v_after := v_current + v_inserted;

  IF v_inserted > 0 THEN
    UPDATE public.usage_counters
    SET
      conversion_sends_count = v_after,
      updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'billed_new', v_inserted,
    'billed_already', v_distinct_count - v_inserted,
    'delta_applied', v_inserted,
    'new_count', v_after
  );
END;
$$;

ALTER FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) OWNER TO postgres;

COMMENT ON FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) IS
  'Atomically: (1) lock usage_counters for site+month, (2) count ledger-eligible queue_ids, (3) if within p_limit '
  'insert oci_conversion_send_billing_ledger ON CONFLICT DO NOTHING and bump conversion_sends_count by inserted rows. '
  'LIMIT returns ok=false before any insert. p_limit < 0 = unlimited. service_role only.';

REVOKE ALL ON FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) FROM anon;
REVOKE ALL ON FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_oci_conversion_sends_v1(uuid, date, uuid[], integer) TO service_role;

COMMIT;
