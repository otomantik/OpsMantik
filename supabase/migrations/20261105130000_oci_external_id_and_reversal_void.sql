BEGIN;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS external_id text;

COMMENT ON COLUMN public.offline_conversion_queue.external_id IS
  'DB-authoritative logical OCI identity. Deterministic across retries so duplicate inserts collide before export.';

CREATE OR REPLACE FUNCTION public.compute_offline_conversion_external_id(
  p_provider_key text DEFAULT 'google_ads',
  p_action text DEFAULT 'purchase',
  p_sale_id uuid DEFAULT NULL,
  p_call_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    'oci_' || md5(
      lower(COALESCE(NULLIF(btrim(p_provider_key), ''), 'google_ads'))
      || '|'
      || lower(COALESCE(NULLIF(btrim(p_action), ''), 'purchase'))
      || '|'
      || COALESCE(p_sale_id::text, '')
      || '|'
      || COALESCE(p_call_id::text, '')
      || '|'
      || COALESCE(p_session_id::text, '')
    );
$$;

COMMENT ON FUNCTION public.compute_offline_conversion_external_id(text, text, uuid, uuid, uuid) IS
  'Deterministically derives the logical OCI external_id from provider/action plus sale/call/session identity.';

CREATE OR REPLACE FUNCTION public.assign_offline_conversion_queue_external_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.external_id := public.compute_offline_conversion_external_id(
    NEW.provider_key,
    NEW.action,
    NEW.sale_id,
    NEW.call_id,
    NEW.session_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assign_offline_conversion_queue_external_id() IS
  'Before-write trigger that keeps offline_conversion_queue.external_id authoritative at the DB boundary.';

DROP TRIGGER IF EXISTS trg_assign_offline_conversion_queue_external_id ON public.offline_conversion_queue;
CREATE TRIGGER trg_assign_offline_conversion_queue_external_id
  BEFORE INSERT OR UPDATE OF provider_key, action, sale_id, call_id, session_id
  ON public.offline_conversion_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_offline_conversion_queue_external_id();

UPDATE public.offline_conversion_queue
SET external_id = public.compute_offline_conversion_external_id(
  provider_key,
  action,
  sale_id,
  call_id,
  session_id
)
WHERE external_id IS NULL
   OR external_id <> public.compute_offline_conversion_external_id(
     provider_key,
     action,
     sale_id,
     call_id,
     session_id
   );

ALTER TABLE public.offline_conversion_queue
  ALTER COLUMN external_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_provider_external_id_active
  ON public.offline_conversion_queue (site_id, provider_key, external_id)
  WHERE external_id IS NOT NULL
    AND status <> 'VOIDED_BY_REVERSAL';

COMMENT ON INDEX public.idx_offline_conversion_queue_site_provider_external_id_active IS
  'Prevents duplicate logical OCI rows per site/provider while still allowing fresh re-enqueue after VOIDED_BY_REVERSAL.';

ALTER TABLE public.offline_conversion_queue
  DROP CONSTRAINT IF EXISTS offline_conversion_queue_status_check;

ALTER TABLE public.offline_conversion_queue
  ADD CONSTRAINT offline_conversion_queue_status_check
  CHECK (
    status IN (
      'QUEUED',
      'RETRY',
      'PROCESSING',
      'UPLOADED',
      'COMPLETED',
      'COMPLETED_UNVERIFIED',
      'FAILED',
      'DEAD_LETTER_QUARANTINE',
      'VOIDED_BY_REVERSAL'
    )
  );

ALTER TABLE public.oci_queue_transitions
  DROP CONSTRAINT IF EXISTS oci_queue_transitions_new_status_check;

ALTER TABLE public.oci_queue_transitions
  ADD CONSTRAINT oci_queue_transitions_new_status_check CHECK (
    new_status IN (
      'QUEUED',
      'RETRY',
      'PROCESSING',
      'UPLOADED',
      'COMPLETED',
      'COMPLETED_UNVERIFIED',
      'FAILED',
      'DEAD_LETTER_QUARANTINE',
      'VOIDED_BY_REVERSAL'
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_offline_conversion_queue_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (
    (OLD.status = 'QUEUED' AND NEW.status IN ('PROCESSING', 'RETRY', 'VOIDED_BY_REVERSAL'))
    OR (OLD.status = 'RETRY' AND NEW.status IN ('PROCESSING', 'QUEUED', 'VOIDED_BY_REVERSAL'))
    OR (
      OLD.status = 'PROCESSING'
      AND NEW.status IN (
        'UPLOADED',
        'COMPLETED',
        'RETRY',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'QUEUED'
      )
    )
    OR (OLD.status = 'UPLOADED' AND NEW.status IN ('COMPLETED', 'COMPLETED_UNVERIFIED'))
    OR (OLD.status = 'FAILED' AND NEW.status = 'RETRY')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal queue transition: % -> %', OLD.status, NEW.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pending_oci_queue_on_call_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at timestamptz := COALESCE(NEW.updated_at, now());
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('cancelled', 'junk', 'intent') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload
  )
  SELECT
    q.id,
    'VOIDED_BY_REVERSAL',
    'MANUAL',
    v_created_at,
    jsonb_build_object(
      'last_error', 'VOIDED_BY_REVERSAL',
      'provider_error_code', 'VOIDED_BY_REVERSAL',
      'provider_error_category', 'DETERMINISTIC_SKIP',
      'clear_fields', jsonb_build_array('next_retry_at', 'uploaded_at', 'claimed_at', 'provider_request_id', 'provider_ref'),
      'reversal_status', NEW.status,
      'call_id', NEW.id
    )
  FROM public.offline_conversion_queue AS q
  WHERE q.site_id = NEW.site_id
    AND q.call_id = NEW.id
    AND q.status IN ('QUEUED', 'RETRY');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.void_pending_oci_queue_on_call_reversal() IS
  'DB trigger: when a call is cancelled/junked/restored to intent, immediately VOID queued/retry OCI rows for the same call.';

DROP TRIGGER IF EXISTS trg_void_pending_oci_queue_on_call_reversal ON public.calls;
CREATE TRIGGER trg_void_pending_oci_queue_on_call_reversal
  AFTER UPDATE OF status
  ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.void_pending_oci_queue_on_call_reversal();

CREATE OR REPLACE FUNCTION public.confirm_sale_and_enqueue(p_sale_id uuid)
RETURNS TABLE(sale_id uuid, new_status text, enqueued boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_primary_source jsonb;
  v_primary_session_id uuid;
  v_consent_scopes text[];
  v_queue_id uuid;
  v_uid uuid;
  v_external_id text;
BEGIN
  v_uid := auth.uid();
  SELECT * INTO v_sale FROM public.sales WHERE public.sales.id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'sale_not_found', ERRCODE = 'P0001'; END IF;
  IF v_uid IS NOT NULL AND NOT public.can_access_site(v_uid, v_sale.site_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'Access denied to this site', ERRCODE = 'P0001';
  END IF;
  IF v_sale.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_already_confirmed_or_canceled', ERRCODE = 'P0001';
  END IF;

  UPDATE public.sales SET status = 'CONFIRMED', updated_at = now() WHERE public.sales.id = p_sale_id;

  IF v_sale.amount_cents IS NULL OR v_sale.amount_cents <= 0 THEN
    RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, false;
    RETURN;
  END IF;

  IF v_sale.conversation_id IS NOT NULL THEN
    SELECT c.primary_source, c.primary_session_id INTO v_primary_source, v_primary_session_id
    FROM public.conversations c WHERE c.id = v_sale.conversation_id LIMIT 1;

    IF v_primary_session_id IS NOT NULL THEN
      SELECT s.consent_scopes INTO v_consent_scopes FROM public.sessions s
      WHERE s.id = v_primary_session_id AND s.site_id = v_sale.site_id LIMIT 1;
      IF v_consent_scopes IS NOT NULL AND 'marketing' = ANY(v_consent_scopes) THEN
        v_external_id := public.compute_offline_conversion_external_id(
          'google_ads',
          'purchase',
          v_sale.id,
          NULL,
          v_primary_session_id
        );

        INSERT INTO public.offline_conversion_queue (
          site_id,
          sale_id,
          session_id,
          provider_key,
          external_id,
          conversion_time,
          value_cents,
          currency,
          gclid,
          wbraid,
          gbraid,
          status
        )
        VALUES (
          v_sale.site_id,
          v_sale.id,
          v_primary_session_id,
          'google_ads',
          v_external_id,
          v_sale.occurred_at,
          v_sale.amount_cents,
          v_sale.currency,
          v_primary_source->>'gclid',
          v_primary_source->>'wbraid',
          v_primary_source->>'gbraid',
          'QUEUED'
        )
        ON CONFLICT ON CONSTRAINT offline_conversion_queue_sale_id_key DO NOTHING
        RETURNING public.offline_conversion_queue.id INTO v_queue_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT p_sale_id, 'CONFIRMED'::text, (v_queue_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.append_script_transition_batch(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_error_payload jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_script_transition_batch may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'SCRIPT',
    p_created_at,
    p_error_payload,
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_worker_transition_batch_v2(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz DEFAULT now(),
  p_error_payload jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_ids uuid[] := ARRAY[]::uuid[];
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING MESSAGE = 'access_denied', DETAIL = 'append_worker_transition_batch_v2 may only be called by service_role', ERRCODE = 'P0001';
  END IF;

  IF p_new_status NOT IN ('RETRY', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'COMPLETED', 'COMPLETED_UNVERIFIED', 'PROCESSING', 'QUEUED', 'UPLOADED', 'VOIDED_BY_REVERSAL') THEN
    RAISE EXCEPTION 'invalid_status: %', p_new_status;
  END IF;

  SELECT COALESCE(array_agg(queue_id ORDER BY queue_id), ARRAY[]::uuid[])
  INTO v_queue_ids
  FROM (
    SELECT DISTINCT queue_id
    FROM unnest(COALESCE(p_queue_ids, ARRAY[]::uuid[])) AS input_ids(queue_id)
    WHERE queue_id IS NOT NULL
  ) AS deduped;

  IF COALESCE(array_length(v_queue_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  INSERT INTO public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  SELECT
    q.id,
    p_new_status,
    'WORKER',
    p_created_at,
    NULLIF(p_error_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  FROM public.offline_conversion_queue AS q
  JOIN unnest(v_queue_ids) AS input_ids(queue_id)
    ON input_ids.queue_id = q.id
  ORDER BY q.id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  PERFORM public.apply_snapshot_batch(v_queue_ids);
  PERFORM public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  RETURN v_inserted;
END;
$$;

COMMIT;
