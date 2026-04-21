BEGIN;

CREATE OR REPLACE FUNCTION public.stage_rank_v1(p_stage text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_stage
    WHEN 'junk' THEN RETURN 0;
    WHEN 'contacted' THEN RETURN 1;
    WHEN 'offered' THEN RETURN 2;
    WHEN 'won' THEN RETURN 3;
    ELSE RETURN NULL;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_stage_monotonicity_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allow_regression boolean := COALESCE(current_setting('app.allow_stage_regression', true), '0') = '1';
  old_rank integer;
  new_rank integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF allow_regression THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'calls' THEN
    old_rank := public.stage_rank_v1(OLD.optimization_stage);
    new_rank := public.stage_rank_v1(NEW.optimization_stage);
    IF old_rank IS NOT NULL AND new_rank IS NOT NULL AND new_rank < old_rank THEN
      RAISE EXCEPTION 'stage regression denied: calls.optimization_stage % -> %', OLD.optimization_stage, NEW.optimization_stage
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'call_funnel_projection' THEN
    old_rank := public.stage_rank_v1(OLD.highest_stage);
    new_rank := public.stage_rank_v1(NEW.highest_stage);
    IF old_rank IS NOT NULL AND new_rank IS NOT NULL AND new_rank < old_rank THEN
      RAISE EXCEPTION 'stage regression denied: projection.highest_stage % -> %', OLD.highest_stage, NEW.highest_stage
        USING ERRCODE = '23514';
    END IF;

    old_rank := public.stage_rank_v1(OLD.current_stage);
    new_rank := public.stage_rank_v1(NEW.current_stage);
    IF old_rank IS NOT NULL AND new_rank IS NOT NULL AND new_rank < old_rank THEN
      RAISE EXCEPTION 'stage regression denied: projection.current_stage % -> %', OLD.current_stage, NEW.current_stage
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calls_stage_monotonicity_v1 ON public.calls;
CREATE TRIGGER trg_calls_stage_monotonicity_v1
BEFORE UPDATE OF optimization_stage ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.enforce_stage_monotonicity_v1();

DROP TRIGGER IF EXISTS trg_projection_stage_monotonicity_v1 ON public.call_funnel_projection;
CREATE TRIGGER trg_projection_stage_monotonicity_v1
BEFORE UPDATE OF highest_stage, current_stage ON public.call_funnel_projection
FOR EACH ROW
EXECUTE FUNCTION public.enforce_stage_monotonicity_v1();

CREATE OR REPLACE FUNCTION public.sweep_stale_ack_receipts_v1(
  p_stale_seconds integer DEFAULT 300,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  receipt_id uuid,
  site_id uuid,
  kind text,
  payload_hash text,
  escalated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT l.id
    FROM public.ack_receipt_ledger l
    WHERE l.apply_state = 'REGISTERED'
      AND l.created_at <= now() - make_interval(secs => GREATEST(1, p_stale_seconds))
      AND l.result_snapshot IS NULL
    ORDER BY l.created_at ASC
    LIMIT GREATEST(1, p_limit)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ack_receipt_ledger t
  SET
    result_snapshot = COALESCE(
      t.result_snapshot,
      jsonb_build_object(
        'ok', false,
        'code', 'ACK_RECEIPT_STALE_ESCALATED',
        'retryable', true,
        'escalated_by', 'sweep_stale_ack_receipts_v1',
        'escalated_at', now()
      )
    ),
    applied_at = COALESCE(t.applied_at, now()),
    apply_state = 'APPLIED',
    replay_count = t.replay_count + 1,
    replayed_last_at = now(),
    updated_at = now()
  FROM stale
  WHERE t.id = stale.id
  RETURNING t.id, t.site_id, t.kind, t.payload_hash, t.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sweep_stale_ack_receipts_v1(integer, integer) TO service_role;

COMMIT;
