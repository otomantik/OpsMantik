-- Add updated_at to marketing_signals for sweep-zombies Phase 2.5 compatibility.
-- sweep-zombies uses .lt('updated_at', ...) to select stuck PROCESSING signals.
-- Backfill from created_at; trigger maintains on UPDATE.

BEGIN;

ALTER TABLE public.marketing_signals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.marketing_signals
  SET updated_at = COALESCE(created_at, now())
  WHERE updated_at IS NULL;

ALTER TABLE public.marketing_signals
  ALTER COLUMN updated_at SET DEFAULT now();

-- Trigger: bump updated_at on any UPDATE (allows sweep + recover flows to work)
CREATE OR REPLACE FUNCTION public._marketing_signals_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_signals_updated_at ON public.marketing_signals;
CREATE TRIGGER trg_marketing_signals_updated_at
  BEFORE UPDATE ON public.marketing_signals
  FOR EACH ROW
  EXECUTE FUNCTION public._marketing_signals_set_updated_at();

COMMENT ON COLUMN public.marketing_signals.updated_at IS
  'Last row update. Used by sweep-zombies (10min) for stuck PROCESSING recovery.';

COMMIT;
