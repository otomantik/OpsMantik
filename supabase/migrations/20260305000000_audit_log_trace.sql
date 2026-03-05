-- Phase 20: Forensic Observability — audit_log for OM-TRACE-UUID chain
-- Tracks event_stage: RECEIVED, GEAR_PROCESSED, QUEUED_IN_QSTASH, SENT_TO_GOOGLE, ACK_RECEIVED

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id text NOT NULL,
  event_stage text NOT NULL CHECK (event_stage IN (
    'RECEIVED', 'GEAR_PROCESSED', 'QUEUED_IN_QSTASH', 'SENT_TO_GOOGLE', 'ACK_RECEIVED'
  )),
  payload jsonb,
  error_stack text,
  created_at timestamptz NOT NULL DEFAULT now(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_trace_id ON public.audit_log (trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_stage ON public.audit_log (event_stage);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at DESC);

COMMENT ON TABLE public.audit_log IS 'Phase 20: Forensic trace chain for OM-TRACE-UUID across sync → QStash → worker → Google export → ACK';
