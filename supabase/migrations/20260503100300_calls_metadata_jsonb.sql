-- apply_call_action_v2 (≥ 20260501193000 / 021030) merges JSON into calls.metadata.
-- Missing column ⇒ runtime: record "v_row" has no field "metadata".

BEGIN;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.calls.metadata IS
  'Audit JSON merged by apply_call_action_v2 (stage, actor_id, sale_metadata, client p_metadata).';

COMMIT;
