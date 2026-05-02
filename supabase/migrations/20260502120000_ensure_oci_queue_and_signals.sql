-- Restore OCI export dependencies when remote drift removed these tables.
-- Idempotent: IF NOT EXISTS on tables and indexes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.offline_conversion_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  sale_id uuid,
  provider text NOT NULL DEFAULT 'google_ads',
  action text NOT NULL DEFAULT 'purchase',
  gclid text,
  wbraid text,
  gbraid text,
  conversion_time timestamptz NOT NULL,
  value_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'TRY',
  status text NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_key text NOT NULL DEFAULT 'google_ads',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz DEFAULT now(),
  provider_ref text,
  claimed_at timestamptz,
  uploaded_at timestamptz,
  provider_request_id text,
  provider_error_code text,
  provider_error_category text,
  call_id uuid,
  session_id uuid,
  causal_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  entropy_score numeric(5, 4) DEFAULT 0,
  uncertainty_bit boolean DEFAULT false,
  discovery_method text,
  discovery_confidence numeric(3, 2),
  brain_score smallint,
  match_score smallint,
  queue_priority smallint NOT NULL DEFAULT 0,
  score_version smallint,
  score_flags integer NOT NULL DEFAULT 0,
  score_explain_jsonb jsonb,
  external_id text NOT NULL,
  occurred_at timestamptz,
  recorded_at timestamptz DEFAULT timezone('utc'::text, now()),
  source_timestamp timestamptz,
  time_confidence text,
  occurred_at_source text,
  entry_reason text,
  optimization_stage text,
  optimization_stage_base text,
  system_score smallint,
  quality_factor numeric,
  optimization_value numeric,
  actual_revenue numeric,
  helper_form_payload jsonb,
  feature_snapshot jsonb DEFAULT '{}'::jsonb,
  outcome_timestamp timestamptz,
  model_version text,
  source_outbox_event_id uuid,
  CONSTRAINT offline_conversion_queue_pkey PRIMARY KEY (id),
  CONSTRAINT offline_conversion_queue_entropy_score_check CHECK (
    entropy_score IS NULL OR (entropy_score >= 0::numeric AND entropy_score <= 1::numeric)
  ),
  CONSTRAINT offline_conversion_queue_occurred_at_source_check CHECK (
    occurred_at_source IS NULL
    OR occurred_at_source = ANY (ARRAY['sale', 'fallback_confirmed', 'legacy_migrated'])
  ),
  CONSTRAINT offline_conversion_queue_sale_or_call_check CHECK (
    (sale_id IS NOT NULL AND call_id IS NULL) OR (sale_id IS NULL AND call_id IS NOT NULL)
  ),
  CONSTRAINT offline_conversion_queue_status_check CHECK (
    status = ANY (
      ARRAY[
        'QUEUED',
        'RETRY',
        'PROCESSING',
        'UPLOADED',
        'COMPLETED',
        'COMPLETED_UNVERIFIED',
        'FAILED',
        'DEAD_LETTER_QUARANTINE',
        'VOIDED_BY_REVERSAL'
      ]
    )
  ),
  CONSTRAINT offline_conversion_queue_time_confidence_check CHECK (
    time_confidence IS NULL
    OR time_confidence = ANY (ARRAY['observed', 'operator_entered', 'inferred', 'legacy_migrated'])
  )
);

CREATE TABLE IF NOT EXISTS public.marketing_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  call_id uuid,
  signal_type text NOT NULL,
  google_conversion_name text NOT NULL,
  google_conversion_time timestamptz NOT NULL DEFAULT now(),
  dispatch_status text NOT NULL DEFAULT 'PENDING',
  google_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  conversion_value numeric,
  causal_dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  entropy_score numeric(5, 4) DEFAULT 0,
  uncertainty_bit boolean DEFAULT false,
  expected_value_cents bigint,
  recovery_attempt_count integer NOT NULL DEFAULT 0,
  last_recovery_attempt_at timestamptz,
  gclid text,
  wbraid text,
  gbraid text,
  adjustment_sequence integer NOT NULL DEFAULT 0,
  previous_hash text,
  current_hash text,
  trace_id text,
  occurred_at timestamptz,
  recorded_at timestamptz DEFAULT timezone('utc'::text, now()),
  source_timestamp timestamptz,
  time_confidence text,
  occurred_at_source text,
  entry_reason text,
  optimization_stage text,
  optimization_stage_base text,
  system_score smallint,
  quality_factor numeric,
  optimization_value numeric,
  actual_revenue numeric,
  helper_form_payload jsonb,
  feature_snapshot jsonb DEFAULT '{}'::jsonb,
  outcome_timestamp timestamptz,
  model_version text,
  CONSTRAINT marketing_signals_pkey PRIMARY KEY (id),
  CONSTRAINT marketing_signals_dispatch_status_check CHECK (
    dispatch_status = ANY (
      ARRAY[
        'PENDING',
        'PROCESSING',
        'SENT',
        'FAILED',
        'JUNK_ABORTED',
        'DEAD_LETTER_QUARANTINE',
        'SKIPPED_NO_CLICK_ID',
        'STALLED_FOR_HUMAN_AUDIT'
      ]
    )
  ),
  CONSTRAINT marketing_signals_entropy_score_check CHECK (
    entropy_score IS NULL OR (entropy_score >= 0::numeric AND entropy_score <= 1::numeric)
  ),
  CONSTRAINT marketing_signals_occurred_at_source_check CHECK (
    occurred_at_source IS NULL
    OR occurred_at_source = ANY (ARRAY['intent', 'qualified', 'proposal', 'legacy_migrated'])
  ),
  CONSTRAINT marketing_signals_time_confidence_check CHECK (
    time_confidence IS NULL
    OR time_confidence = ANY (ARRAY['observed', 'operator_entered', 'inferred', 'legacy_migrated'])
  )
);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_id ON public.offline_conversion_queue USING btree (site_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_provider_external_id_active ON public.offline_conversion_queue USING btree (site_id, provider_key, external_id)
WHERE
  status <> ALL (
    ARRAY[
      'VOIDED_BY_REVERSAL',
      'COMPLETED',
      'UPLOADED',
      'COMPLETED_UNVERIFIED',
      'FAILED'
    ]
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_conversion_queue_site_session_pending ON public.offline_conversion_queue USING btree (site_id, session_id)
WHERE
  status = ANY (ARRAY['QUEUED', 'RETRY', 'PROCESSING'])
  AND session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_signals_chain ON public.marketing_signals USING btree (site_id, call_id, google_conversion_name, adjustment_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_signals_site_call_gear_seq ON public.marketing_signals USING btree (site_id, call_id, google_conversion_name, adjustment_sequence)
WHERE
  call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_signals_pending ON public.marketing_signals USING btree (site_id, created_at)
WHERE
  dispatch_status = 'PENDING';

COMMIT;
