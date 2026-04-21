BEGIN;

-- Forward-compatible unified OCI dispatch surface (core spine plan).
-- Application code still reads offline_conversion_queue + outbox_events; this table
-- is reserved for the merge cutover (dual-write → single reader → drain → drop).

CREATE TABLE IF NOT EXISTS public.conversion_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('offline_queue', 'outbox_event', 'legacy_placeholder')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'DEAD')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversion_dispatch_site_status_idx
  ON public.conversion_dispatch (site_id, status);

COMMENT ON TABLE public.conversion_dispatch IS
  'Planned single dispatch table merging offline_conversion_queue and outbox_events (not yet populated by app code).';

REVOKE ALL ON TABLE public.conversion_dispatch FROM PUBLIC;
GRANT ALL ON TABLE public.conversion_dispatch TO service_role;

COMMIT;
