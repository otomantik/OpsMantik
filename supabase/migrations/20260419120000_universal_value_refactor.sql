ALTER TABLE public.calls
ADD COLUMN IF NOT EXISTS optimization_stage text,
ADD COLUMN IF NOT EXISTS system_score integer,
ADD COLUMN IF NOT EXISTS quality_factor numeric(8,4),
ADD COLUMN IF NOT EXISTS optimization_value numeric(12,2),
ADD COLUMN IF NOT EXISTS actual_revenue numeric(12,2),
ADD COLUMN IF NOT EXISTS helper_form_payload jsonb,
ADD COLUMN IF NOT EXISTS feature_snapshot jsonb,
ADD COLUMN IF NOT EXISTS outcome_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS model_version text;

ALTER TABLE public.marketing_signals
ADD COLUMN IF NOT EXISTS optimization_stage text,
ADD COLUMN IF NOT EXISTS optimization_stage_base numeric(12,2),
ADD COLUMN IF NOT EXISTS system_score integer,
ADD COLUMN IF NOT EXISTS quality_factor numeric(8,4),
ADD COLUMN IF NOT EXISTS optimization_value numeric(12,2),
ADD COLUMN IF NOT EXISTS actual_revenue numeric(12,2),
ADD COLUMN IF NOT EXISTS helper_form_payload jsonb,
ADD COLUMN IF NOT EXISTS feature_snapshot jsonb,
ADD COLUMN IF NOT EXISTS outcome_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS model_version text;

ALTER TABLE public.offline_conversion_queue
ADD COLUMN IF NOT EXISTS optimization_stage text,
ADD COLUMN IF NOT EXISTS optimization_stage_base numeric(12,2),
ADD COLUMN IF NOT EXISTS system_score integer,
ADD COLUMN IF NOT EXISTS quality_factor numeric(8,4),
ADD COLUMN IF NOT EXISTS optimization_value numeric(12,2),
ADD COLUMN IF NOT EXISTS actual_revenue numeric(12,2),
ADD COLUMN IF NOT EXISTS helper_form_payload jsonb,
ADD COLUMN IF NOT EXISTS feature_snapshot jsonb,
ADD COLUMN IF NOT EXISTS outcome_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS model_version text;

CREATE INDEX IF NOT EXISTS idx_marketing_signals_optimization_stage
ON public.marketing_signals (optimization_stage);

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_optimization_stage
ON public.offline_conversion_queue (optimization_stage);
