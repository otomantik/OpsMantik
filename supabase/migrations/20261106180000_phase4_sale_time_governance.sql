BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS sale_is_backdated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sale_backdated_seconds integer,
  ADD COLUMN IF NOT EXISTS sale_review_status text DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS sale_review_requested_at timestamptz;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS entry_reason text,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_status_check'
  ) THEN
    ALTER TABLE public.sales DROP CONSTRAINT sales_status_check;
  END IF;

  ALTER TABLE public.sales
    ADD CONSTRAINT sales_status_check
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'CANCELED'));

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.calls'::regclass
      AND conname = 'calls_sale_review_status_check'
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_sale_review_status_check
      CHECK (sale_review_status IS NULL OR sale_review_status IN ('NONE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'));
  END IF;
END
$$;

UPDATE public.calls
SET
  sale_review_status = COALESCE(sale_review_status, 'NONE'),
  sale_is_backdated = COALESCE(sale_is_backdated, false)
WHERE sale_review_status IS NULL
   OR sale_is_backdated IS NULL;

CREATE INDEX IF NOT EXISTS idx_calls_site_sale_review_status
  ON public.calls (site_id, sale_review_status, created_at DESC)
  WHERE sale_review_status IS NOT NULL AND sale_review_status <> 'NONE';

CREATE INDEX IF NOT EXISTS idx_sales_site_status_occurred_at
  ON public.sales (site_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entry_reason
  ON public.audit_log ((payload->>'entry_reason'), created_at DESC)
  WHERE payload ? 'entry_reason';

COMMENT ON COLUMN public.calls.sale_is_backdated IS
  'True when sale_occurred_at is earlier than the system recorded confirmation time.';
COMMENT ON COLUMN public.calls.sale_backdated_seconds IS
  'Delta in seconds between recorded confirmation time and sale_occurred_at.';
COMMENT ON COLUMN public.calls.sale_review_status IS
  'Governance state for manual V5 time overrides: NONE, PENDING_APPROVAL, APPROVED, REJECTED.';
COMMENT ON COLUMN public.calls.sale_review_requested_at IS
  'Timestamp when a backdated sale time entered approval workflow.';
COMMENT ON COLUMN public.sales.entry_reason IS
  'Operator-provided reason for manual occurred_at entry or correction.';
COMMENT ON COLUMN public.sales.approval_requested_at IS
  'Timestamp when a sales row entered PENDING_APPROVAL for backdated occurred_at.';

CREATE OR REPLACE FUNCTION public.apply_call_action_v1(
  p_call_id uuid,
  p_action_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_type text DEFAULT 'user',
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_call public.calls%ROWTYPE;
  v_site_id uuid;
  v_prev_status text;
  v_new_status text;
  v_now timestamptz := now();
  v_actor_type text;
  v_actor_id uuid;
  v_revert jsonb;
  v_updated public.calls%ROWTYPE;
  v_sale_amount numeric;
  v_currency text;
  v_lead_score integer;
  v_oci_status text;
  v_has_caller_phone boolean;
BEGIN
  IF p_call_id IS NULL THEN
    RAISE EXCEPTION 'call_id_required' USING ERRCODE = '22023';
  END IF;

  v_actor_type := COALESCE(NULLIF(btrim(lower(p_actor_type)), ''), 'user');
  IF v_actor_type = 'user' THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
    END IF;
  ELSE
    v_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_call
  FROM public.calls c
  WHERE c.id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found' USING ERRCODE = '02000';
  END IF;

  IF p_version IS NOT NULL AND v_call.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'concurrency_conflict: version mismatch' USING ERRCODE = 'P0002';
  END IF;

  v_site_id := v_call.site_id;
  v_prev_status := v_call.status;
  v_revert := to_jsonb(v_call);

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    IF v_prev_status IN ('junk', 'cancelled') THEN
      RAISE EXCEPTION 'cannot_seal_from_junk_or_cancelled' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF (p_payload ? 'sale_amount') THEN
    v_sale_amount := (p_payload->>'sale_amount')::numeric;
  END IF;
  v_currency := COALESCE(p_payload->>'currency', v_call.currency);
  IF (p_payload ? 'lead_score') THEN
    v_lead_score := (p_payload->>'lead_score')::int;
  END IF;
  IF (p_payload ? 'oci_status') THEN
    v_oci_status := p_payload->>'oci_status';
  END IF;

  v_has_caller_phone := (p_payload ? 'caller_phone_raw') OR (p_payload ? 'caller_phone_e164') OR (p_payload ? 'caller_phone_hash_sha256');

  IF lower(p_action_type) IN ('seal','confirm','confirmed','auto_approve') THEN
    v_new_status := 'confirmed';
    IF v_has_caller_phone THEN
      PERFORM set_config('app.allow_caller_phone', '1', true);
    END IF;

    UPDATE public.calls
    SET
      status = v_new_status,
      sale_amount = v_sale_amount,
      currency = v_currency,
      confirmed_at = v_now,
      confirmed_by = CASE WHEN v_actor_type = 'user' THEN v_actor_id ELSE NULL END,
      version = version + 1,
      lead_score = COALESCE(v_lead_score, lead_score),
      oci_status = COALESCE(v_oci_status, 'sealed'),
      oci_status_updated_at = v_now,
      caller_phone_raw = CASE WHEN (p_payload ? 'caller_phone_raw') THEN NULLIF(btrim(p_payload->>'caller_phone_raw'), '') ELSE caller_phone_raw END,
      caller_phone_e164 = CASE WHEN (p_payload ? 'caller_phone_e164') THEN NULLIF(btrim(p_payload->>'caller_phone_e164'), '') ELSE caller_phone_e164 END,
      caller_phone_hash_sha256 = CASE WHEN (p_payload ? 'caller_phone_hash_sha256') THEN NULLIF(btrim(p_payload->>'caller_phone_hash_sha256'), '') ELSE caller_phone_hash_sha256 END,
      phone_source_type = CASE WHEN v_has_caller_phone THEN 'operator_verified' ELSE phone_source_type END,
      sale_occurred_at = CASE WHEN (p_payload ? 'sale_occurred_at') THEN (p_payload->>'sale_occurred_at')::timestamptz ELSE sale_occurred_at END,
      sale_source_timestamp = CASE WHEN (p_payload ? 'sale_source_timestamp') THEN NULLIF(btrim(p_payload->>'sale_source_timestamp'), '')::timestamptz ELSE sale_source_timestamp END,
      sale_time_confidence = CASE WHEN (p_payload ? 'sale_time_confidence') THEN NULLIF(btrim(p_payload->>'sale_time_confidence'), '') ELSE sale_time_confidence END,
      sale_occurred_at_source = CASE WHEN (p_payload ? 'sale_occurred_at_source') THEN NULLIF(btrim(p_payload->>'sale_occurred_at_source'), '') ELSE sale_occurred_at_source END,
      sale_entry_reason = CASE WHEN (p_payload ? 'sale_entry_reason') THEN NULLIF(btrim(p_payload->>'sale_entry_reason'), '') ELSE sale_entry_reason END,
      sale_is_backdated = CASE WHEN (p_payload ? 'sale_is_backdated') THEN COALESCE((p_payload->>'sale_is_backdated')::boolean, false) ELSE sale_is_backdated END,
      sale_backdated_seconds = CASE WHEN (p_payload ? 'sale_backdated_seconds') THEN NULLIF(btrim(p_payload->>'sale_backdated_seconds'), '')::integer ELSE sale_backdated_seconds END,
      sale_review_status = CASE WHEN (p_payload ? 'sale_review_status') THEN NULLIF(btrim(p_payload->>'sale_review_status'), '') ELSE sale_review_status END,
      sale_review_requested_at = CASE WHEN (p_payload ? 'sale_review_requested_at') THEN NULLIF(btrim(p_payload->>'sale_review_requested_at'), '')::timestamptz ELSE sale_review_requested_at END
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

    IF COALESCE(v_updated.oci_status, '') NOT IN ('skipped', 'pending_approval') THEN
      INSERT INTO public.outbox_events (event_type, payload, call_id, site_id, status)
      VALUES (
        'IntentSealed',
        jsonb_build_object(
          'call_id', p_call_id,
          'site_id', v_site_id,
          'lead_score', v_updated.lead_score,
          'confirmed_at', v_updated.confirmed_at,
          'created_at', v_updated.created_at,
          'sale_amount', v_updated.sale_amount,
          'currency', COALESCE(v_currency, v_updated.currency),
          'oci_status', v_updated.oci_status,
          'sale_occurred_at', v_updated.sale_occurred_at,
          'sale_source_timestamp', v_updated.sale_source_timestamp,
          'sale_time_confidence', v_updated.sale_time_confidence,
          'sale_occurred_at_source', v_updated.sale_occurred_at_source,
          'sale_entry_reason', v_updated.sale_entry_reason
        ),
        p_call_id,
        v_site_id,
        'PENDING'
      );
    END IF;

  ELSIF lower(p_action_type) IN ('junk','ai_junk') THEN
    v_new_status := 'junk';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = NULL,
      oci_status = COALESCE(v_oci_status, NULL),
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSIF lower(p_action_type) IN ('cancel','cancelled') THEN
    v_new_status := 'cancelled';
    UPDATE public.calls
    SET
      status = v_new_status,
      version = version + 1,
      cancelled_at = v_now,
      oci_status = COALESCE(v_oci_status, NULL),
      oci_status_updated_at = v_now
    WHERE id = p_call_id
    RETURNING * INTO v_updated;

  ELSE
    UPDATE public.calls
    SET
      status = COALESCE(v_new_status, status),
      version = version + 1,
      updated_at = v_now,
      oci_status = COALESCE(v_oci_status, oci_status)
    WHERE id = p_call_id
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO public.call_actions (call_id, site_id, action_type, actor_type, actor_id, previous_status, new_status, revert_snapshot, metadata)
  VALUES (p_call_id, v_site_id, lower(p_action_type), v_actor_type, v_actor_id, v_prev_status, v_new_status, v_revert, p_metadata);

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) TO service_role;

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
  IF v_sale.status = 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION USING MESSAGE = 'sale_pending_approval', ERRCODE = 'P0001';
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
          occurred_at,
          source_timestamp,
          time_confidence,
          occurred_at_source,
          entry_reason,
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
          v_sale.occurred_at,
          v_sale.occurred_at,
          'observed',
          'sale',
          v_sale.entry_reason,
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

COMMENT ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) IS
  'Seal/confirm branch persists caller phone and sale governance metadata; skips outbox when oci_status is skipped or pending_approval.';

COMMIT;
