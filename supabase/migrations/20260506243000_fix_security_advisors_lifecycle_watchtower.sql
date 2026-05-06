BEGIN;

-- Fix linter: avoid definer-like behavior on exposed view.
ALTER VIEW IF EXISTS public.pipeline_health_watchtower
  SET (security_invoker = true);

-- Fix linter: enforce RLS on public tables exposed via Data API.
ALTER TABLE IF EXISTS public.lifecycle_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lifecycle_transitions ENABLE ROW LEVEL SECURITY;

-- Keep existing authenticated read contract explicit under RLS.
DROP POLICY IF EXISTS lifecycle_statuses_select_authenticated ON public.lifecycle_statuses;
CREATE POLICY lifecycle_statuses_select_authenticated
ON public.lifecycle_statuses
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS lifecycle_transitions_select_authenticated ON public.lifecycle_transitions;
CREATE POLICY lifecycle_transitions_select_authenticated
ON public.lifecycle_transitions
FOR SELECT
TO authenticated
USING (true);

COMMIT;
