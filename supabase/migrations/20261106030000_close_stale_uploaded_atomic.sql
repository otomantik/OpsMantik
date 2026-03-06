-- Migration: close_stale_uploaded_conversions RPC (atomic Phase 3 zombie sweep)
--
-- Replaces the 2-step SELECT → append_sweeper_transition_batch pattern in
-- /api/cron/oci/sweep-zombies (Phase 3) which had a TOCTOU race: two concurrent
-- sweeper runs could both select the same UPLOADED rows and both try to close them,
-- causing count mismatches and spurious errors.
--
-- This RPC selects and updates in a single CTE (one round-trip, one atomic transaction).

create or replace function public.close_stale_uploaded_conversions(
  p_min_age_hours integer default 48
)
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
  v_cutoff timestamptz;
  v_now    timestamptz;
begin
  v_now    := now();
  v_cutoff := v_now - (p_min_age_hours || ' hours')::interval;

  with closed as (
    update public.offline_conversion_queue
    set
      status     = 'COMPLETED_UNVERIFIED',
      updated_at = v_now,
      last_error = 'Closed by zombie sweeper: UPLOADED for > ' || p_min_age_hours || 'h without verification'
    where
      status     = 'UPLOADED'
      and updated_at < v_cutoff
    returning id
  )
  select count(*) into v_count from closed;

  return v_count;
end;
$$;

grant execute on function public.close_stale_uploaded_conversions(integer) to service_role;
