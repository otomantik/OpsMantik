-- Align queue constraint with zero-tolerance conversion-time DB guard.
-- Trigger now stamps occurred_at_source='intent' for call-bound OCI queue rows.

begin;

alter table public.offline_conversion_queue
  drop constraint if exists offline_conversion_queue_occurred_at_source_check;

alter table public.offline_conversion_queue
  add constraint offline_conversion_queue_occurred_at_source_check
  check (
    occurred_at_source is null
    or occurred_at_source = any (array['intent', 'sale', 'fallback_confirmed', 'legacy_migrated'])
  );

commit;
