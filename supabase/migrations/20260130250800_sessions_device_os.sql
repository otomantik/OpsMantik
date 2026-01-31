-- HunterCard Data Correctness v1: device label (single source of truth = sessions).
-- Sync writes UAParser getOS().name (e.g. iOS, Android); card shows richer label.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS device_os TEXT;

COMMENT ON COLUMN public.sessions.device_os IS 'OS from User-Agent (e.g. iOS, Android). Single source for device label.';

CREATE INDEX IF NOT EXISTS idx_sessions_device_os ON public.sessions(device_os) WHERE device_os IS NOT NULL;
