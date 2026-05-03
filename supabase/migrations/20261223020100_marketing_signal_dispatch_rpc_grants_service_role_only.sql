-- Supabase advisor 0028/0029: marketing signal dispatch kernels are SECURITY DEFINER + service_role gated in-body.
-- Idempotent tighten for databases that ran an earlier revision without REVOKE.

BEGIN;

REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1(uuid, uuid[], text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rescue_marketing_signals_stale_processing_v1(timestamptz) TO service_role;

COMMIT;
