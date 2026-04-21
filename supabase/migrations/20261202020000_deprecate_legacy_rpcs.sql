-- Migration: Deprecate Legacy OCI RPCs
-- Description: Adds deprecation warnings to v1 RPCs replaced by apply_call_action_v2.

DO $$
BEGIN
  IF to_regprocedure('public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer)') IS NOT NULL THEN
    EXECUTE $comment$
      COMMENT ON FUNCTION public.apply_call_action_v1(uuid, text, jsonb, text, uuid, jsonb, integer) IS
      'DEPRECATED: Use apply_call_action_v2 for canonical pipeline stages (junk, contacted, offered, won). This v1 function is preserved for rollback safety but should not be used for new development.'
    $comment$;
  END IF;

  IF to_regprocedure('public.undo_last_action_v1(uuid, text, uuid, jsonb)') IS NOT NULL THEN
    EXECUTE $comment$
      COMMENT ON FUNCTION public.undo_last_action_v1(uuid, text, uuid, jsonb) IS
      'DEPRECATED: Use apply_call_action_v2 with p_stage=''contacted'' to restore leads. This v1 undo function is preserved for existing audit chain compatibility.'
    $comment$;
  ELSIF to_regprocedure('public.undo_last_action_v1(uuid, uuid, jsonb)') IS NOT NULL THEN
    EXECUTE $comment$
      COMMENT ON FUNCTION public.undo_last_action_v1(uuid, uuid, jsonb) IS
      'DEPRECATED: Use apply_call_action_v2 with p_stage=''contacted'' to restore leads. This v1 undo function is preserved for existing audit chain compatibility.'
    $comment$;
  END IF;
END $$;
