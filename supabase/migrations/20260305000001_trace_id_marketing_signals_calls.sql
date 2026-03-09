-- Phase 20: OM-TRACE-UUID for forensic chain in marketing_signals and calls
-- Note: marketing_signals is created in 20260329; this migration runs earlier, so we guard with IF EXISTS.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_signals') THEN
    ALTER TABLE public.marketing_signals ADD COLUMN IF NOT EXISTS trace_id text;
    COMMENT ON COLUMN public.marketing_signals.trace_id IS 'Phase 20: OM-TRACE-UUID from sync/call-event request for forensic audit chain';
    CREATE INDEX IF NOT EXISTS idx_marketing_signals_trace_id ON public.marketing_signals (trace_id) WHERE trace_id IS NOT NULL;
  END IF;
END
$$;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS trace_id text;
COMMENT ON COLUMN public.calls.trace_id IS 'Phase 20: OM-TRACE-UUID from call-event request for forensic audit chain';
CREATE INDEX IF NOT EXISTS idx_calls_trace_id ON public.calls (trace_id) WHERE trace_id IS NOT NULL;
