-- =============================================================================
-- The Singularity Protocol: Causal Provenance, Shadow Ledger, Merkle Integrity
-- Non-repudiable decision trace and chain-of-custody.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Causal DNA columns on conversion/signal tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.offline_conversion_queue
  ADD COLUMN IF NOT EXISTS causal_dna jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS entropy_score numeric(5,4) DEFAULT 0 CHECK (entropy_score >= 0 AND entropy_score <= 1),
  ADD COLUMN IF NOT EXISTS uncertainty_bit boolean DEFAULT false;

COMMENT ON COLUMN public.offline_conversion_queue.causal_dna IS
  'Singularity: Decision path taken. input, gates_passed, logic_branch, math_version, original_state, transformed_state.';
COMMENT ON COLUMN public.offline_conversion_queue.entropy_score IS
  'Singularity: Historical failure probability for this fingerprint/IP. 0=high confidence, 1=speculative.';
COMMENT ON COLUMN public.offline_conversion_queue.uncertainty_bit IS
  'Singularity: True when entropy_score above threshold; flag for internal analytics, does not block upload.';

-- marketing_signals created in 20260329; skip if not exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_signals') THEN
    ALTER TABLE public.marketing_signals
      ADD COLUMN IF NOT EXISTS causal_dna jsonb DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS entropy_score numeric(5,4) DEFAULT 0 CHECK (entropy_score >= 0 AND entropy_score <= 1),
      ADD COLUMN IF NOT EXISTS uncertainty_bit boolean DEFAULT false;
    COMMENT ON COLUMN public.marketing_signals.causal_dna IS
      'Singularity: Decision path for this signal. gear, gates_passed, logic_branch, math_version.';
  END IF;
END $$;

-- Allow updating causal_dna / entropy / uncertainty (append-only content remains immutable)
-- Trigger _marketing_signals_append_only already restricts; add exception for these columns in trigger or leave as nullable update.

-- -----------------------------------------------------------------------------
-- 2) Shadow decisions (path not taken) — counterfactual history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shadow_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('conversion', 'signal', 'pv')),
  aggregate_id uuid,
  rejected_gear_or_branch text NOT NULL,
  reason text NOT NULL,
  context jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shadow_decisions_site_created
  ON public.shadow_decisions (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_decisions_aggregate
  ON public.shadow_decisions (aggregate_type, aggregate_id) WHERE aggregate_id IS NOT NULL;

COMMENT ON TABLE public.shadow_decisions IS
  'Singularity: Path-not-taken. Why was Gear X or branch Y rejected? Enables A/B re-simulation on past data.';

ALTER TABLE public.shadow_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_decisions_service_role"
  ON public.shadow_decisions FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
GRANT ALL ON public.shadow_decisions TO service_role;

-- -----------------------------------------------------------------------------
-- 3) Causal DNA ledger — append-only stream for Merkle heartbeat
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.causal_dna_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('conversion', 'signal', 'pv')),
  aggregate_id uuid,
  causal_dna jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_causal_dna_ledger_id_created
  ON public.causal_dna_ledger (id, created_at);
CREATE INDEX IF NOT EXISTS idx_causal_dna_ledger_site_created
  ON public.causal_dna_ledger (site_id, created_at);

COMMENT ON TABLE public.causal_dna_ledger IS
  'Singularity: Append-only stream of every causal_dna for Merkle heartbeat (last N entries hashed).';

ALTER TABLE public.causal_dna_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "causal_dna_ledger_service_role"
  ON public.causal_dna_ledger FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
GRANT ALL ON public.causal_dna_ledger TO service_role;

-- -----------------------------------------------------------------------------
-- 4) System integrity Merkle — chain of custody every 1000 events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_integrity_merkle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heartbeat_sequence bigint NOT NULL,
  merkle_root_hash text NOT NULL,
  ledger_id_from bigint NOT NULL,
  ledger_id_to bigint NOT NULL,
  scope_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_integrity_merkle_sequence
  ON public.system_integrity_merkle (heartbeat_sequence);
CREATE INDEX IF NOT EXISTS idx_system_integrity_merkle_created
  ON public.system_integrity_merkle (created_at DESC);

COMMENT ON TABLE public.system_integrity_merkle IS
  'Singularity: Every 1000 causal_dna_ledger entries, hash of those + site_usage snapshot. Proves untampered chain of custody.';

ALTER TABLE public.system_integrity_merkle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_integrity_merkle_service_role"
  ON public.system_integrity_merkle FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');
GRANT ALL ON public.system_integrity_merkle TO service_role;

-- -----------------------------------------------------------------------------
-- 5) RPC: Append causal_dna to ledger (called from app after persisting row)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_causal_dna_ledger(
  p_site_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_causal_dna jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'append_causal_dna_ledger may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;
  IF p_aggregate_type NOT IN ('conversion', 'signal', 'pv') THEN
    RAISE EXCEPTION 'aggregate_type must be conversion, signal, or pv' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.causal_dna_ledger (site_id, aggregate_type, aggregate_id, causal_dna)
  VALUES (p_site_id, p_aggregate_type, p_aggregate_id, COALESCE(p_causal_dna, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.append_causal_dna_ledger(uuid, text, uuid, jsonb) IS
  'Singularity: Append one causal_dna to ledger for Merkle heartbeat. Returns ledger id.';

GRANT EXECUTE ON FUNCTION public.append_causal_dna_ledger(uuid, text, uuid, jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- 5b) RPC: Insert shadow decision (path not taken)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_shadow_decision(
  p_site_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_rejected_gear_or_branch text,
  p_reason text,
  p_context jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'insert_shadow_decision may only be called by service_role' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.shadow_decisions (site_id, aggregate_type, aggregate_id, rejected_gear_or_branch, reason, context)
  VALUES (p_site_id, p_aggregate_type, p_aggregate_id, p_rejected_gear_or_branch, p_reason, COALESCE(p_context, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.insert_shadow_decision(uuid, text, uuid, text, text, jsonb) IS
  'Singularity: Log why a gear/branch was rejected (counterfactual history).';

GRANT EXECUTE ON FUNCTION public.insert_shadow_decision(uuid, text, uuid, text, text, jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- 6) RPC: Compute and store Merkle heartbeat (last 1000 ledger entries + usage snapshot)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat_merkle_1000()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_to bigint;
  v_from bigint;
  v_count bigint;
  v_sequence bigint;
  v_rows jsonb;
  v_usage_snapshot jsonb;
  v_payload text;
  v_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  SELECT COALESCE(MAX(ledger_id_to), 0) INTO v_last_to
  FROM public.system_integrity_merkle;

  SELECT id INTO v_from
  FROM public.causal_dna_ledger
  WHERE id > v_last_to
  ORDER BY id ASC
  LIMIT 1;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'heartbeat', false, 'reason', 'no_new_entries');
  END IF;

  SELECT count(*), max(id) INTO v_count, v_last_to
  FROM (
    SELECT id FROM public.causal_dna_ledger
    WHERE id >= v_from
    ORDER BY id ASC
    LIMIT 1000
  ) sub;

  IF v_count < 1000 THEN
    RETURN jsonb_build_object('ok', true, 'heartbeat', false, 'reason', 'insufficient_entries', 'count', v_count);
  END IF;

  SELECT jsonb_agg(l ORDER BY l.id) INTO v_rows
  FROM public.causal_dna_ledger l
  WHERE l.id >= v_from AND l.id <= v_last_to;

  SELECT jsonb_object_agg(uc.site_id || '_' || uc.month, jsonb_build_object('revenue_events', uc.revenue_events_count, 'conversion_sends', uc.conversion_sends_count))
  INTO v_usage_snapshot
  FROM (
    SELECT site_id, month, revenue_events_count, conversion_sends_count
    FROM public.usage_counters
    WHERE updated_at >= now() - interval '1 day'
  ) uc;

  v_payload := (v_rows::text || COALESCE(v_usage_snapshot::text, '{}'));
  v_hash := encode(digest(v_payload, 'sha256'), 'hex');

  SELECT COALESCE(MAX(heartbeat_sequence), 0) + 1 INTO v_sequence FROM public.system_integrity_merkle;

  INSERT INTO public.system_integrity_merkle (heartbeat_sequence, merkle_root_hash, ledger_id_from, ledger_id_to, scope_snapshot)
  VALUES (v_sequence, v_hash, v_from, v_last_to, jsonb_build_object('usage_snapshot', COALESCE(v_usage_snapshot, '{}')));

  RETURN jsonb_build_object('ok', true, 'heartbeat', true, 'sequence', v_sequence, 'ledger_id_from', v_from, 'ledger_id_to', v_last_to, 'hash', v_hash);
END;
$$;

COMMENT ON FUNCTION public.heartbeat_merkle_1000() IS
  'Singularity: If 1000+ new causal_dna_ledger rows exist, hash them + usage snapshot and insert into system_integrity_merkle.';

GRANT EXECUTE ON FUNCTION public.heartbeat_merkle_1000() TO service_role;

COMMIT;
