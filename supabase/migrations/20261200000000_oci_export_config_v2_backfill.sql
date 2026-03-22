-- ─────────────────────────────────────────────────────────────────────────────
-- OCI Export Config V2: SiteExportConfig Backfill
--
-- Populates sites.oci_config with the full SiteExportConfig schema for all
-- existing sites that currently have an empty or null oci_config.
--
-- New fields:
--   conversion_actions: channel × gear → { action_name, role, adjustable }
--   gear_weights:       { V2, V3, V4 } — V3 canonical 0.20
--   decay:              { mode, disable_for_all } — tiered by default
--   enhanced_conversions: { enabled, fallback_identifiers, use_oct_fallback }
--   adjustments:        { enabled, supported_types, max_adjustment_age_days }
--   signal_value:       1 (Google Ads requires value > 0 for signal_only)
--   v5_fallback_value:  500 (TRY fallback for V5_SEAL without sale_amount)
--   script_ack_timeout_minutes: 30 (was 10 — prevents sweep-ACK race)
--
-- Sites with an existing non-empty oci_config are NOT touched (safe to re-run).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.sites
SET oci_config = jsonb_build_object(

  -- Channel routing
  'channels',           ARRAY['phone', 'whatsapp']::text[],

  -- Modül 2: Conversion actions with Primary/Secondary roles
  -- V5_SEAL is primary (enters Smart Bidding tROAS).
  -- All other stages are secondary (observation only, no ROAS inflation).
  'conversion_actions', jsonb_build_object(
    'phone:V1_PAGEVIEW',  jsonb_build_object('action_name', 'OpsMantik_V1_Nabiz',               'role', 'secondary', 'adjustable', false),
    'phone:V2_PULSE',     jsonb_build_object('action_name', 'OpsMantik_V2_Ilk_Temas',            'role', 'secondary', 'adjustable', false),
    'phone:V3_ENGAGE',    jsonb_build_object('action_name', 'OpsMantik_V3_Nitelikli_Gorusme',    'role', 'secondary', 'adjustable', false),
    'phone:V4_INTENT',    jsonb_build_object('action_name', 'OpsMantik_V4_Sicak_Teklif',         'role', 'secondary', 'adjustable', false),
    'phone:V5_SEAL',      jsonb_build_object('action_name', 'OpsMantik_V5_DEMIR_MUHUR',          'role', 'primary',   'adjustable', true),
    'whatsapp:V2_PULSE',  jsonb_build_object('action_name', 'OpsMantik_WA_Temas',                'role', 'secondary', 'adjustable', false),
    'whatsapp:V3_ENGAGE', jsonb_build_object('action_name', 'OpsMantik_WA_Nitelikli',            'role', 'secondary', 'adjustable', false),
    'form:V2_PULSE',      jsonb_build_object('action_name', 'OpsMantik_Form_Gonder',             'role', 'secondary', 'adjustable', false)
  ),

  -- Value mode: AOV formula as default
  'value_mode',         'aov_formula',

  -- Currency from site row; fallback TRY
  'currency',           COALESCE(
                          (SELECT currency FROM public.sites s2 WHERE s2.id = sites.id LIMIT 1),
                          'TRY'
                        ),

  -- AOV: use existing default_aov if present, else 1000
  'default_aov',        COALESCE(
                          (sites.oci_config->>'default_aov')::numeric,
                          1000
                        ),

  -- Gear weights: V3 canonical = 0.20 (was incorrectly 0.10 in legacy code)
  'gear_weights',       '{"V2": 0.02, "V3": 0.20, "V4": 0.30}'::jsonb,

  -- V5 fallback: 500 major units (e.g. 500 TRY) when sale_amount is missing
  'v5_fallback_value',  500,

  -- Signal value: 1 (Google Ads minimum; required for signal_only mode)
  'signal_value',       1,

  -- Modül 4: Decay — tiered by default, V5 always no-decay (hard rule in code)
  'decay',              '{"mode": "tiered", "disable_for_all": false, "linear_decay_rate": 0.5, "half_life_days": 7}'::jsonb,

  -- Timezone: keep existing or default to Istanbul
  'timezone',           COALESCE(
                          (sites.oci_config->>'timezone'),
                          'Europe/Istanbul'
                        ),

  -- Max click age: 90 days (Google Ads limit)
  'max_click_age_days', 90,

  -- Click ID required
  'require_click_id',   true,

  -- Export method: prefer existing setting
  'export_method',      COALESCE(
                          (sites.oci_config->>'export_method'),
                          'script'
                        ),

  -- ACK timeout: 30 minutes (up from legacy 10-minute hardcode)
  -- Prevents sweep-ACK race for large Google Ads Script CSV uploads (5–20 min)
  'script_ack_timeout_minutes', 30,

  -- Modül 3: Enhanced Conversions (disabled by default — opt-in per site)
  'enhanced_conversions', '{"enabled": false, "fallback_identifiers": ["hashed_phone"], "use_oct_fallback": false}'::jsonb,

  -- Modül 1: Adjustments (disabled by default — enable per site when needed)
  'adjustments',        '{"enabled": false, "supported_types": ["RETRACTION", "RESTATEMENT"], "max_adjustment_age_days": 90}'::jsonb

)
WHERE oci_config IS NULL
   OR oci_config = '{}'::jsonb
   OR oci_config = 'null'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query (run manually to confirm)
-- SELECT id, name, oci_config->>'value_mode', oci_config->'gear_weights'
-- FROM public.sites
-- ORDER BY created_at;
-- ─────────────────────────────────────────────────────────────────────────────
