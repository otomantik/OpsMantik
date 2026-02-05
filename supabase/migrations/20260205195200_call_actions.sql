-- Migration: Event-Sourcing Lite — call_actions audit log
-- Date: 2026-02-05
--
-- Purpose:
-- - Provide an append-only audit trail for call/intents actions (seal, junk, cancel, restore, auto_approve, etc.)
-- - Enable reliable Undo via revert_snapshot (exact pre-update state)
--
-- Security:
-- - RLS enabled (SECURITY INVOKER patterns; no SECURITY DEFINER required)
-- - SELECT allowed for site owner, any site member (incl viewer), or admin (like calls_select_accessible)
-- - INSERT allowed only for site owner/editor/admin (viewers cannot mutate)

BEGIN;

CREATE TABLE IF NOT EXISTS public.call_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  -- Denormalize site_id for fast filtering + RLS without joins
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  action_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  previous_status text NULL,
  new_status text NULL,

  -- CRITICAL: exact pre-update state (fields before mutation)
  revert_snapshot jsonb NOT NULL,

  -- Extra context (reason codes, request_id, payload summary, model/rule version, etc.)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_actions_actor_type_chk
    CHECK (actor_type IN ('user','system'))
);

COMMENT ON TABLE public.call_actions IS
'Event-Sourcing Lite audit log for calls/intents. Append-only. revert_snapshot stores exact pre-update state for safe Undo.';
COMMENT ON COLUMN public.call_actions.revert_snapshot IS
'Exact pre-update snapshot of calls row (or relevant fields) before action applied. Used for reliable Undo.';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_call_actions_call_id_created_at_desc
  ON public.call_actions(call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_actions_site_id_action_type_created_at_desc
  ON public.call_actions(site_id, action_type, created_at DESC);

-- RLS
ALTER TABLE public.call_actions ENABLE ROW LEVEL SECURITY;

-- SELECT: owner, any member (incl viewer), admin
DROP POLICY IF EXISTS "call_actions_select_accessible" ON public.call_actions;
CREATE POLICY "call_actions_select_accessible"
  ON public.call_actions FOR SELECT
  USING (
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.call_actions.site_id LIMIT 1) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.site_id = public.call_actions.site_id AND sm.user_id = auth.uid()
    )
    OR public.is_admin(auth.uid())
  );

-- INSERT: only owner/editor/admin (viewers cannot create actions)
DROP POLICY IF EXISTS "call_actions_insert_owner_editor_admin" ON public.call_actions;
CREATE POLICY "call_actions_insert_owner_editor_admin"
  ON public.call_actions FOR INSERT
  WITH CHECK (
    (SELECT s.user_id FROM public.sites s WHERE s.id = public.call_actions.site_id LIMIT 1) = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.site_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.site_id = public.call_actions.site_id
        AND sm.role IN ('owner','editor')
    )
    OR public.is_admin(auth.uid())
  );

-- No UPDATE/DELETE policies → immutable log by default.

COMMIT;

