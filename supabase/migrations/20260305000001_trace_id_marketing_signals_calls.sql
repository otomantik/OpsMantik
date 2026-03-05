-- Phase 20: OM-TRACE-UUID for forensic chain in marketing_signals and calls

ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS trace_id text;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS trace_id text;

COMMENT ON COLUMN public.marketing_signals.trace_id IS 'Phase 20: OM-TRACE-UUID from sync/call-event request for forensic audit chain';
COMMENT ON COLUMN public.calls.trace_id IS 'Phase 20: OM-TRACE-UUID from call-event request for forensic audit chain';

CREATE INDEX IF NOT EXISTS idx_marketing_signals_trace_id ON public.marketing_signals (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_trace_id ON public.calls (trace_id) WHERE trace_id IS NOT NULL;
