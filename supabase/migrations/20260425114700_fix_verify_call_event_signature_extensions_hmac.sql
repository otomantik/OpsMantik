-- Runtime evidence (42883) showed hmac lookup failure in verify_call_event_signature_v1.
-- Use extensions.hmac with explicit casts to avoid search_path/function-resolution drift.

create extension if not exists pgcrypto;

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
  v_expected_current := encode(
    extensions.hmac(v_message::bytea, v_secret.current_secret::bytea, 'sha256'::text),
    'hex'
  );
  if lower(coalesce(p_signature, '')) = lower(v_expected_current) then
    return true;
  end if;

  if v_secret.next_secret is not null and length(trim(v_secret.next_secret)) >= 16 then
    v_expected_next := encode(
      extensions.hmac(v_message::bytea, v_secret.next_secret::bytea, 'sha256'::text),
      'hex'
    );
    if lower(coalesce(p_signature, '')) = lower(v_expected_next) then
      return true;
    end if;
  end if;

  return false;
end;
$$;
