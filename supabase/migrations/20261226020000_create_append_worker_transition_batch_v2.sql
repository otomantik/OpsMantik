begin;

create or replace function public.append_worker_transition_batch_v2(
  p_queue_ids uuid[],
  p_new_status text,
  p_created_at timestamptz default now(),
  p_error_payload jsonb default null
) returns integer
language plpgsql
security definer
set search_path to public
as $$
declare
  v_queue_ids uuid[] := array[]::uuid[];
  v_inserted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception
      using message = 'access_denied',
            detail = 'append_worker_transition_batch_v2 may only be called by service_role',
            errcode = 'P0001';
  end if;

  if p_new_status not in (
    'RETRY',
    'FAILED',
    'DEAD_LETTER_QUARANTINE',
    'COMPLETED',
    'COMPLETED_UNVERIFIED',
    'PROCESSING',
    'QUEUED',
    'UPLOADED',
    'VOIDED_BY_REVERSAL'
  ) then
    raise exception 'invalid_status: %', p_new_status;
  end if;

  select coalesce(array_agg(queue_id order by queue_id), array[]::uuid[])
  into v_queue_ids
  from (
    select distinct queue_id
    from unnest(coalesce(p_queue_ids, array[]::uuid[])) as input_ids(queue_id)
    where queue_id is not null
  ) as deduped;

  if coalesce(array_length(v_queue_ids, 1), 0) = 0 then
    return 0;
  end if;

  perform set_config('opsmantik.skip_snapshot_trigger', 'on', true);

  insert into public.oci_queue_transitions (
    queue_id,
    new_status,
    actor,
    created_at,
    error_payload,
    brain_score,
    match_score,
    queue_priority,
    score_version,
    score_flags,
    score_explain_jsonb
  )
  select
    q.id,
    p_new_status,
    'WORKER',
    p_created_at,
    nullif(p_error_payload, '{}'::jsonb),
    q.brain_score,
    q.match_score,
    q.queue_priority,
    q.score_version,
    q.score_flags,
    q.score_explain_jsonb
  from public.offline_conversion_queue as q
  join unnest(v_queue_ids) as input_ids(queue_id)
    on input_ids.queue_id = q.id
  order by q.id;

  get diagnostics v_inserted = row_count;

  perform public.apply_snapshot_batch(v_queue_ids);
  perform public.assert_latest_ledger_matches_snapshot(v_queue_ids);

  return v_inserted;
end;
$$;

alter function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) owner to postgres;

revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from public;
revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from anon;
revoke all on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) from authenticated;
grant execute on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb) to service_role;

comment on function public.append_worker_transition_batch_v2(uuid[], text, timestamptz, jsonb)
is 'Phase 23C generic worker-owned batch append/apply path with full JSONB snapshot payload support.';

commit;
