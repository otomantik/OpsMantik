-- Drift repair: OCI outbox / export / ACK select `calls.oci_status`. Some tenants never received the column.
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS oci_status text;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS oci_status_updated_at timestamptz;

COMMIT;
