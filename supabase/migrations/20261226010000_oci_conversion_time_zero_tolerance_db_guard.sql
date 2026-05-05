-- OCI Conversion Time Zero Tolerance (DB Guard)
-- Enforce calls.created_at as the only authoritative conversion timestamp source
-- for call-bound rows across OCI export tables.

set check_function_bodies = off;

create or replace function public.enforce_oci_queue_conversion_time_from_call_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call_created_at timestamptz;
begin
  if new.call_id is null then
    return new;
  end if;

  select c.created_at
    into v_call_created_at
  from public.calls c
  where c.id = new.call_id
    and c.site_id = new.site_id
  limit 1;

  if v_call_created_at is null then
    raise exception
      using message = 'OCI_CONVERSION_TIME_CALL_NOT_FOUND',
            detail = format('offline_conversion_queue call_id=%s site_id=%s', new.call_id, new.site_id),
            errcode = 'P0001';
  end if;

  new.occurred_at := v_call_created_at;
  new.conversion_time := v_call_created_at;
  new.source_timestamp := v_call_created_at;
  new.occurred_at_source := 'intent';
  new.time_confidence := 'observed';
  return new;
end;
$$;

drop trigger if exists trg_enforce_oci_queue_conversion_time_from_call_created_at on public.offline_conversion_queue;
create trigger trg_enforce_oci_queue_conversion_time_from_call_created_at
before insert or update on public.offline_conversion_queue
for each row
execute function public.enforce_oci_queue_conversion_time_from_call_created_at();

create or replace function public.enforce_marketing_signal_time_from_call_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call_created_at timestamptz;
begin
  if new.call_id is null then
    return new;
  end if;

  select c.created_at
    into v_call_created_at
  from public.calls c
  where c.id = new.call_id
    and c.site_id = new.site_id
  limit 1;

  if v_call_created_at is null then
    raise exception
      using message = 'OCI_CONVERSION_TIME_CALL_NOT_FOUND',
            detail = format('marketing_signals call_id=%s site_id=%s', new.call_id, new.site_id),
            errcode = 'P0001';
  end if;

  new.occurred_at := v_call_created_at;
  new.google_conversion_time := v_call_created_at;
  return new;
end;
$$;

drop trigger if exists trg_enforce_marketing_signal_time_from_call_created_at on public.marketing_signals;
create trigger trg_enforce_marketing_signal_time_from_call_created_at
before insert or update on public.marketing_signals
for each row
execute function public.enforce_marketing_signal_time_from_call_created_at();
