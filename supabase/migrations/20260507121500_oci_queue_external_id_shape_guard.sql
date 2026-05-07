-- Export journal: deterministic external_id shape (matches computeOfflineConversionExternalId → oci_ + 32 hex).
-- NOT VALID: existing rows are not scanned at deploy time; new/updated rows must satisfy the check.

begin;

alter table public.offline_conversion_queue
  drop constraint if exists offline_conversion_queue_external_id_shape_chk;

alter table public.offline_conversion_queue
  add constraint offline_conversion_queue_external_id_shape_chk
  check (external_id ~ '^oci_[0-9a-f]{32}$')
  not valid;

comment on constraint offline_conversion_queue_external_id_shape_chk on public.offline_conversion_queue is
  'D1: journal external_id must match SHA256-prefix shape from lib/oci/external-id.ts. VALIDATE CONSTRAINT after legacy cleanup if needed.';

commit;
