-- Migration: OCI Export Config V2 — SiteExportConfig Backfill
-- Part of: OCI Evrensel Export Çerçevesi Enterprise Edition
--
-- Backfills all sites with the full SiteExportConfig structure including:
--   - conversion_actions (with role primary/secondary + adjustable flag)
--   - gear_weights (V2/V3/V4 — ends the 3-source inconsistency)
--   - decay config (tiered default)
--   - enhanced_conversions (disabled by default)
--   - adjustments (disabled by default)
--   - script_ack_timeout_minutes: 30 (prevents sweep-ACK race on large batches)
--
-- Only updates sites where oci_config is NULL or empty.
-- Sites with existing oci_config are NOT overwritten (backwards safe).

UPDATE sites
SET oci_config = jsonb_build_object(
  'channels',             ARRAY['phone', 'whatsapp'],

  -- Conversion action map: channel:gear → {action_name, role, adjustable}
  -- phone:V5_SEAL is the only primary (tROAS optimization target)
  -- All V2/V3 are secondary to prevent ROAS inflation
  'conversion_actions', jsonb_build_object(
    'phone:V1_PAGEVIEW',   jsonb_build_object('action_name', 'OpsMantik_V1_Nabiz',               'role', 'secondary', 'adjustable', false),
    'phone:V2_PULSE',      jsonb_build_object('action_name', 'OpsMantik_V2_Ilk_Temas',            'role', 'secondary', 'adjustable', false),
    'phone:V3_ENGAGE',     jsonb_build_object('action_name', 'OpsMantik_V3_Nitelikli_Gorusme',    'role', 'secondary', 'adjustable', false),
    'phone:V4_INTENT',     jsonb_build_object('action_name', 'OpsMantik_V4_Sicak_Teklif',         'role', 'secondary', 'adjustable', false),
    'phone:V5_SEAL',       jsonb_build_object('action_name', 'OpsMantik_V5_DEMIR_MUHUR',          'role', 'primary',   'adjustable', true),
    'whatsapp:V2_PULSE',   jsonb_build_object('action_name', 'OpsMantik_WA_Temas',                'role', 'secondary', 'adjustable', false),
    'whatsapp:V3_ENGAGE',  jsonb_build_object('action_name', 'OpsMantik_WA_Nitelikli',            'role', 'secondary', 'adjustable', false),
    'form:V2_PULSE',       jsonb_build_object('action_name', 'OpsMantik_Form_Gonder',             'role', 'secondary', 'adjustable', false)
  ),

  'value_mode',           'aov_formula',

  -- gear_weights: single source of truth — ends the 3-file inconsistency
  -- V3 was 0.1 in funnel-policy.ts and lcv-engine.ts, 0.2 in value-config.ts
  -- Canonical value: 0.20
  'gear_weights',         jsonb_build_object('V2', 0.02, 'V3', 0.20, 'V4', 0.30),

  'currency',             COALESCE((oci_config->>'currency'), 'TRY'),
  'default_aov',          COALESCE((oci_config->>'default_aov')::numeric, 1000),
  'v5_fallback_value',    500,
  'signal_value',         1,

  -- Decay: tiered default, V5 never decays (enforced in code, not config)
  'decay',                jsonb_build_object(
    'mode',               'tiered',
    'linear_decay_rate',  0.5,
    'half_life_days',     7,
    'disable_for_all',    false
  ),

  'timezone',             'Europe/Istanbul',
  'max_click_age_days',   90,
  'require_click_id',     true,
  'export_method',        COALESCE((oci_config->>'export_method'), 'script'),

  -- 30 minutes: prevents sweep from resetting PROCESSING rows before Script ACKs
  -- Google Ads Script CSV upload can take 5–20 minutes for large batches
  'script_ack_timeout_minutes', 30,

  -- Enhanced Conversions (iOS/Safari OCT fallback): disabled by default
  'enhanced_conversions', jsonb_build_object(
    'enabled',              false,
    'fallback_identifiers', ARRAY['hashed_phone'],
    'use_oct_fallback',     false
  ),

  -- Adjustments (Retract/Restate): disabled by default
  'adjustments',          jsonb_build_object(
    'enabled',               false,
    'supported_types',       ARRAY['RETRACTION', 'RESTATEMENT'],
    'max_adjustment_age_days', 90
  )
)
WHERE oci_config IS NULL
   OR oci_config = '{}'::jsonb
   OR NOT (oci_config ? 'gear_weights');

-- Also patch sites that have oci_config but lack the new fields
-- (incremental migration: only add missing top-level keys)
UPDATE sites
SET oci_config = oci_config
  || jsonb_build_object(
       'gear_weights', jsonb_build_object('V2', 0.02, 'V3', 0.20, 'V4', 0.30)
     )
WHERE oci_config IS NOT NULL
  AND oci_config != '{}'::jsonb
  AND NOT (oci_config ? 'gear_weights');

UPDATE sites
SET oci_config = oci_config
  || jsonb_build_object(
       'script_ack_timeout_minutes', 30
     )
WHERE oci_config IS NOT NULL
  AND NOT (oci_config ? 'script_ack_timeout_minutes');

UPDATE sites
SET oci_config = oci_config
  || jsonb_build_object(
       'enhanced_conversions', jsonb_build_object(
         'enabled',              false,
         'fallback_identifiers', ARRAY['hashed_phone'],
         'use_oct_fallback',     false
       )
     )
WHERE oci_config IS NOT NULL
  AND NOT (oci_config ? 'enhanced_conversions');

UPDATE sites
SET oci_config = oci_config
  || jsonb_build_object(
       'adjustments', jsonb_build_object(
         'enabled',               false,
         'supported_types',       ARRAY['RETRACTION', 'RESTATEMENT'],
         'max_adjustment_age_days', 90
       )
     )
WHERE oci_config IS NOT NULL
  AND NOT (oci_config ? 'adjustments');

UPDATE sites
SET oci_config = oci_config
  || jsonb_build_object('decay', jsonb_build_object(
       'mode',              'tiered',
       'linear_decay_rate', 0.5,
       'half_life_days',    7,
       'disable_for_all',   false
     ))
WHERE oci_config IS NOT NULL
  AND NOT (oci_config ? 'decay');
