-- =============================================================================
-- Sprint 1.6b — Per-Site OCI Conversion Value Config
-- Adds oci_config JSONB to sites table.
-- Workers and enqueue logic read this to compute star-based conversion values.
--
-- Config shape (all optional — system uses defaults if missing):
-- {
--   "base_value": 500,          -- 5-star conversion value in currency units
--   "currency":   "TRY",        -- ISO currency code (inherited from site default)
--   "min_star":   3,            -- stars below this are NOT sent to Google Ads
--   "weights": {                -- value = base_value × weight[star]
--     "3": 0.5,                 -- 3★ → 250 TRY (base=500)
--     "4": 0.8,                 -- 4★ → 400 TRY
--     "5": 1.0                  -- 5★ → 500 TRY (or actual revenue if provided)
--   }
-- }
-- =============================================================================

BEGIN;

-- Add oci_config JSONB column to sites
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS oci_config jsonb DEFAULT NULL;

COMMENT ON COLUMN public.sites.oci_config IS
  'Per-site OCI conversion value configuration. '
  'Keys: base_value (numeric), currency (text), min_star (1-5), weights ({star: multiplier}).';

COMMIT;
