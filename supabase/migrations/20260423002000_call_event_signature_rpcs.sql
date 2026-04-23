create extension if not exists pgcrypto;

create schema if not exists private;

create table if not exists private.site_secrets (
  site_id uuid primary key references public.sites(id) on delete cascade,
  current_secret text not null,
  next_secret text null,
  updated_at timestamptz not null default now()
);

create or replace function public.resolve_site_identifier_v1(
  p_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input text := trim(coalesce(p_input, ''));
  v_site_id uuid;
begin
  if v_input = '' then
    return null;
  end if;

  if v_input ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_site_id from public.sites where id = v_input::uuid limit 1;
    return v_site_id;
  end if;

  select id into v_site_id from public.sites where public_id = v_input limit 1;
  return v_site_id;
end;
$$;

create or replace function public.rotate_site_secret_v1(
  p_site_public_id text,
  p_current_secret text,
  p_next_secret text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_site_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required' using errcode = 'P0001';
  end if;

  select id into v_site_id
  from public.sites
  where public_id = trim(coalesce(p_site_public_id, ''))
  limit 1;

  if v_site_id is null then
    return false;
  end if;

  insert into private.site_secrets (site_id, current_secret, next_secret, updated_at)
  values (v_site_id, trim(coalesce(p_current_secret, '')), p_next_secret, now())
  on conflict (site_id) do update
    set current_secret = excluded.current_secret,
        next_secret = excluded.next_secret,
        updated_at = now();

  return true;
end;
$$;

create or replace function private.get_site_secrets(
  p_site_id uuid
)
returns table(current_secret text, next_secret text)
language sql
security definer
set search_path = private
as $$
  select s.current_secret, s.next_secret
  from private.site_secrets s
  where s.site_id = p_site_id
  limit 1;
$$;

create or replace function public.verify_call_event_signature_v1(
  p_site_public_id text,
  p_ts bigint,
  p_raw_body text,
  p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_site_id uuid;
  v_secret record;
  v_message text;
  v_expected_current text;
  v_expected_next text;
begin
  select id into v_site_id
  from public.sites
  where public_id = trim(coalesce(p_site_public_id, ''))
  limit 1;

  if v_site_id is null then
    return false;
  end if;

  select current_secret, next_secret
  into v_secret
  from private.site_secrets
  where site_id = v_site_id
  limit 1;

  if v_secret.current_secret is null or length(trim(v_secret.current_secret)) < 16 then
    return false;
  end if;

  v_message := trim(coalesce(p_ts::text, '')) || '.' || coalesce(p_raw_body, '');
  v_expected_current := encode(hmac(v_message, v_secret.current_secret, 'sha256'), 'hex');
  if lower(coalesce(p_signature, '')) = lower(v_expected_current) then
    return true;
  end if;

  if v_secret.next_secret is not null and length(trim(v_secret.next_secret)) >= 16 then
    v_expected_next := encode(hmac(v_message, v_secret.next_secret, 'sha256'), 'hex');
    if lower(coalesce(p_signature, '')) = lower(v_expected_next) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

grant usage on schema private to service_role;

grant execute on function public.resolve_site_identifier_v1(text) to anon, authenticated, service_role;
grant execute on function public.verify_call_event_signature_v1(text, bigint, text, text) to anon, authenticated, service_role;
grant execute on function public.rotate_site_secret_v1(text, text, text) to service_role;
grant execute on function private.get_site_secrets(uuid) to service_role;
