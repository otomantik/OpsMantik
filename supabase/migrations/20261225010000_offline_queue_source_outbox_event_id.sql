BEGIN;

ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS source_outbox_event_id uuid NULL REFERENCES public.outbox_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offline_conversion_queue_source_outbox_event_id
  ON public.offline_conversion_queue(source_outbox_event_id);

COMMIT;
