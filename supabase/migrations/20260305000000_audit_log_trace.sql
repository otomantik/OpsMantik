-- Phase 20: Forensic Observability — audit_log for OM-TRACE-UUID chain
-- audit_log already exists from 20260219100000 (actor_type, action, etc.). Add trace_id + event_stage if missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'trace_id'
  ) THEN
    ALTER TABLE public.audit_log ADD COLUMN trace_id text;
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS event_stage text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_trace_id ON public.audit_log (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_event_stage ON public.audit_log (event_stage) WHERE event_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at DESC);

COMMENT ON TABLE public.audit_log IS 'Phase 20: Forensic trace chain for OM-TRACE-UUID across sync → QStash → worker → Google export → ACK';
