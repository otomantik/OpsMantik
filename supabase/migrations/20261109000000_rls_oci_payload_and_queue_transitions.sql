-- Lint fix: Enable RLS on oci_payload_validation_events and oci_queue_transitions.
-- No policies: service_role only (bypasses RLS). Matches provider_health_state pattern.

ALTER TABLE public.oci_payload_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oci_queue_transitions ENABLE ROW LEVEL SECURITY;
