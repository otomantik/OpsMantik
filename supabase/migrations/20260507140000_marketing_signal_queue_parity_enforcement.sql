-- Marketing signals -> queue parity enforcement (observe/enforce)
-- Default mode is observe to avoid breaking existing write flow.

create table if not exists public.parity_audit_log (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid null references public.marketing_signals(id) on delete set null,
  site_id uuid not null,
  call_id uuid null,
  stage text null,
  reason_code text not null,
  parity_key text not null,
  mode text not null default 'observe',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.parity_violation_dlq (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid null references public.marketing_signals(id) on delete set null,
  site_id uuid not null,
  call_id uuid null,
  stage text null,
  reason_code text not null,
  parity_key text not null,
  mode text not null default 'observe',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists idx_parity_audit_log_site_created
  on public.parity_audit_log(site_id, created_at desc);

create index if not exists idx_parity_violation_dlq_site_created
  on public.parity_violation_dlq(site_id, created_at desc)
  where resolved_at is null;

create or replace function public.resolve_oci_parity_mode()
returns text
language sql
stable
as $$
  select case lower(coalesce(current_setting('app.settings.oci_marketing_signal_queue_parity_enforcement', true), 'observe'))
    when 'enforce' then 'enforce'
    else 'observe'
  end;
$$;

create or replace function public.enforce_marketing_signal_queue_parity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parity_mode text := public.resolve_oci_parity_mode();
  has_click boolean;
  parity_key text;
  has_queue boolean;
begin
  has_click := coalesce(nullif(trim(new.gclid), ''), nullif(trim(new.wbraid), ''), nullif(trim(new.gbraid), '')) is not null;

  -- Queue parity scope: canonical google-bound micro stages with click ids.
  if not has_click then
    return new;
  end if;

  if new.call_id is null then
    return new;
  end if;

  if new.google_conversion_name not in ('OpsMantik_Contacted', 'OpsMantik_Offered', 'OpsMantik_Junk_Exclusion') then
    return new;
  end if;

  parity_key := concat_ws(':', new.site_id::text, new.call_id::text, new.google_conversion_name);

  select exists (
    select 1
    from public.offline_conversion_queue q
    where q.site_id = new.site_id
      and q.call_id = new.call_id
      and q.provider_key = 'google_ads'
      and q.action = new.google_conversion_name
  )
  into has_queue;

  if has_queue then
    return new;
  end if;

  insert into public.parity_audit_log(signal_id, site_id, call_id, stage, reason_code, parity_key, mode, payload)
  values (
    new.id,
    new.site_id,
    new.call_id,
    new.signal_type,
    'PARITY_VIOLATION_OPEN',
    parity_key,
    parity_mode,
    jsonb_build_object('dispatch_status', new.dispatch_status, 'conversion_name', new.google_conversion_name)
  );

  insert into public.parity_violation_dlq(signal_id, site_id, call_id, stage, reason_code, parity_key, mode, payload)
  values (
    new.id,
    new.site_id,
    new.call_id,
    new.signal_type,
    'PARITY_VIOLATION_OPEN',
    parity_key,
    parity_mode,
    jsonb_build_object('dispatch_status', new.dispatch_status, 'conversion_name', new.google_conversion_name)
  );

  perform pg_notify('parity_violation', parity_key);

  if parity_mode = 'enforce' then
    raise exception 'PARITY_VIOLATION_OPEN: marketing_signals row has no queue match'
      using errcode = 'P0001',
            detail = parity_key,
            hint = 'Ensure enqueue parity writes offline_conversion_queue row for this call/stage.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_marketing_signal_queue_parity on public.marketing_signals;

create trigger trg_marketing_signal_queue_parity
after insert or update of dispatch_status, google_conversion_name, gclid, wbraid, gbraid, call_id
on public.marketing_signals
for each row
execute function public.enforce_marketing_signal_queue_parity();
