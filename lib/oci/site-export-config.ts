/**
 * SiteExportConfig — OCI Evrensel Export Çerçevesi Enterprise Edition
 *
 * Per-site config stored in sites.oci_config JSONB.
 * Covers: channel routing, value modes, decay algorithm,
 * enhanced conversions (wbraid/gbraid/OCT), and adjustment support.
 *
 * This is the single source of truth for all OCI value and export decisions.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Modül 2: Conversion Action Config (Primary / Secondary)
// ─────────────────────────────────────────────────────────────────────────────

export const ConversionActionConfigSchema = z.object({
  /** Exact name as it appears in the Google Ads account for this site */
  action_name: z.string().min(1),
  /**
   * primary: Counts toward Smart Bidding (tROAS, Maximize Conversion Value).
   * secondary: Observation only — does NOT inflate ROAS.
   * Rule: If V5_SEAL is primary, all V2/V3 MUST be secondary to avoid ROAS inflation.
   */
  role: z.enum(['primary', 'secondary']).default('secondary'),
  /**
   * Adjustment-eligible: RETRACTION and RESTATEMENT enabled for this action.
   * Only meaningful for V5_SEAL (explicit mode). Must be true to use /api/oci/adjustments.
   */
  adjustable: z.boolean().default(false),
});

export type ConversionActionConfig = z.infer<typeof ConversionActionConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Modül 4: Decay Algorithm Config
// ─────────────────────────────────────────────────────────────────────────────

export const DecayConfigSchema = z.object({
  /**
   * V2/V3/V4 decay mode.
   * tiered:    0-3d/3-10d/10+d step function (current, default)
   * none:      No decay — flat rate. Best when value_mode=explicit + V5 primary.
   *            Avoids Double Penalty with Google Smart Bidding's own conversion delay model.
   * half_life: Exponential 0.5^(days/half_life_days)
   * linear:    1 - (days/max_click_age_days) * linear_decay_rate
   *
   * V5_SEAL: decay is NEVER applied regardless of this setting. Hard rule.
   */
  mode: z.enum(['tiered', 'none', 'half_life', 'linear']).default('tiered'),
  linear_decay_rate: z.number().min(0).max(1).default(0.5),
  half_life_days: z.number().positive().default(7),
  /** Override: disable decay for all gears (equivalent to mode=none) */
  disable_for_all: z.boolean().default(false),
});

export type DecayConfig = z.infer<typeof DecayConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Modül 3: Enhanced Conversions Config (iOS/Safari / Click-less OCT)
// ─────────────────────────────────────────────────────────────────────────────

export const EnhancedConversionsConfigSchema = z.object({
  /** Master switch for Enhanced Conversions */
  enabled: z.boolean().default(false),
  /**
   * Click-less fallback identifiers.
   * Used when gclid/wbraid/gbraid are all null.
   * Order matters: first match wins.
   */
  fallback_identifiers: z.array(
    z.enum(['hashed_phone', 'hashed_email'])
  ).default(['hashed_phone']),
  /**
   * OCT (Offline Conversion Tracking) fallback.
   * When true and no click ID exists, hashed identifier is sent via Enhanced Conversions for Leads.
   * Google matches the hash to a logged-in Google user.
   */
  use_oct_fallback: z.boolean().default(false),
});

export type EnhancedConversionsConfig = z.infer<typeof EnhancedConversionsConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Channel and Value Mode Types
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelKey = 'phone' | 'whatsapp' | 'form' | 'ecommerce';
export type ValueMode = 'signal_only' | 'aov_formula' | 'explicit';

const ChannelKeyEnum = z.enum(['phone', 'whatsapp', 'form', 'ecommerce']);
const ValueModeEnum = z.enum(['signal_only', 'aov_formula', 'explicit']);

// ─────────────────────────────────────────────────────────────────────────────
// Main Config Schema
// ─────────────────────────────────────────────────────────────────────────────

export const SiteExportConfigSchema = z.object({

  // ── Channel Definition ──────────────────────────────────────────────────
  channels: z.array(ChannelKeyEnum).min(1).default(['phone']),

  // ── Modül 2: Google Ads Action Map (Primary/Secondary) ─────────────────
  // Key format: "{channel}:{gear}"  e.g. "phone:V5_SEAL", "whatsapp:V2_PULSE"
  // String shorthand is accepted for backwards compatibility and auto-normalized to secondary.
  conversion_actions: z.record(
    z.string(),
    z.union([
      ConversionActionConfigSchema,
      z.string().transform(s => ({
        action_name: s,
        role: 'secondary' as const,
        adjustable: false,
      })),
    ])
  ).default({}),

  // ── Value Mode ─────────────────────────────────────────────────────────
  /** Global default value mode for all channels/gears */
  value_mode: ValueModeEnum.default('aov_formula'),
  /** Per-channel value mode override */
  channel_value_mode: z.record(ChannelKeyEnum, ValueModeEnum).optional(),

  // ── Value Parameters ───────────────────────────────────────────────────
  currency: z.string().length(3).default('TRY'),
  default_aov: z.number().positive().default(1000),
  /** Per-channel AOV override (e.g. phone AOV differs from form AOV) */
  channel_aov: z.record(ChannelKeyEnum, z.number().positive()).optional(),
  gear_weights: z.object({
    /** V2_PULSE: first contact weight (0-100 scale) */
    V2: z.number().min(0).max(100).default(2),
    /** V3_ENGAGE: qualified engagement weight (0-100 scale) */
    V3: z.number().min(0).max(100).default(20),
    /** V4_INTENT: hot intent weight (0-100 scale) */
    V4: z.number().min(0).max(100).default(30),
  }).default({ V2: 2, V3: 20, V4: 30 }),
  /**
   * V5 fallback value in major currency units.
   * Used when: gear=V5_SEAL AND sale_amount is null/zero.
   * Decay is NEVER applied to this value.
   */
  v5_fallback_value: z.number().positive().default(500),
  /** Fixed value for signal_only mode (Google Ads requires > 0) */
  signal_value: z.number().positive().default(1),

  // ── Modül 4: Decay Config ──────────────────────────────────────────────
  decay: DecayConfigSchema.default({
    mode: 'tiered',
    linear_decay_rate: 0.5,
    half_life_days: 7,
    disable_for_all: false,
  }),

  // ── Temporal Rules ─────────────────────────────────────────────────────
  timezone: z.string().default('Europe/Istanbul'),
  /** Google Ads hard limit: 90 days. Rows older than this are EXPIRED. */
  max_click_age_days: z.number().int().min(1).max(90).default(90),

  // ── Export Rules ───────────────────────────────────────────────────────
  /**
   * When true: rows without any click ID (gclid/wbraid/gbraid) are VOIDED
   * unless OCT fallback is enabled and a hashed identifier is available.
   */
  require_click_id: z.boolean().default(true),
  export_method: z.enum(['script', 'api']).default('script'),
  /**
   * How long the Script has to ACK before sweep resets PROCESSING to PENDING.
   * Google Ads Script CSV upload takes 5-20 minutes for large batches.
   * Default 30 minutes provides safe headroom.
   */
  script_ack_timeout_minutes: z.number().int().min(5).max(120).default(30),

  // ── Modül 3: Enhanced Conversions ─────────────────────────────────────
  enhanced_conversions: EnhancedConversionsConfigSchema.default({
    enabled: false,
    fallback_identifiers: ['hashed_phone'],
    use_oct_fallback: false,
  }),

  // ── Modül 1: Adjustment Config ─────────────────────────────────────────
  adjustments: z.object({
    enabled: z.boolean().default(false),
    supported_types: z.array(
      z.enum(['RETRACTION', 'RESTATEMENT'])
    ).default(['RETRACTION', 'RESTATEMENT']),
    /** Google Ads does not accept adjustments older than 90 days */
    max_adjustment_age_days: z.number().int().min(1).max(90).default(90),
  }).default({
    enabled: false,
    supported_types: ['RETRACTION', 'RESTATEMENT'],
    max_adjustment_age_days: 90,
  }),
});

export type SiteExportConfig = z.infer<typeof SiteExportConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseExportConfig(raw: unknown): SiteExportConfig {
  const result = SiteExportConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    console.warn('[OCI_CONFIG_PARSE_ERROR]', result.error.flatten());
    return SiteExportConfigSchema.parse({});
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve conversion action config for a given channel × gear. Returns null if not configured. */
export function getConversionActionConfig(
  config: SiteExportConfig,
  channel: ChannelKey,
  gear: string
): ConversionActionConfig | null {
  const key = `${channel}:${gear}`;
  const raw = config.conversion_actions[key];
  if (!raw) return null;
  return raw;
}

/** Get the Google Ads action name for a channel × gear. Returns null if not configured. */
export function getActionName(
  config: SiteExportConfig,
  channel: ChannelKey,
  gear: string
): string | null {
  return getConversionActionConfig(config, channel, gear)?.action_name ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modül 2: ROAS Inflation Validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns warning strings if the config risks ROAS inflation.
 * Called at config parse time — operator is notified, config is NOT rejected.
 *
 * Risk: V5_SEAL is primary AND value_mode != signal_only, but V2/V3 are also primary.
 * Effect: Same user journey sends V2 (200 TRY) + V3 (1000 TRY) + V5 (5000 TRY) = 6200 TRY.
 * Google counts all 6200 TRY toward ROAS, real revenue is only 5000 TRY (+24% inflation).
 */
export function validateRoasInflation(config: SiteExportConfig): string[] {
  const warnings: string[] = [];

  const hasExplicitV5 = Object.entries(config.conversion_actions).some(
    ([key, ac]) => key.endsWith(':V5_SEAL') && ac.role === 'primary'
  );

  if (hasExplicitV5 && config.value_mode !== 'signal_only') {
    const inflatingActions = Object.entries(config.conversion_actions).filter(
      ([key, ac]) =>
        (key.includes(':V2_PULSE') || key.includes(':V3_ENGAGE')) &&
        ac.role === 'primary'
    );

    if (inflatingActions.length > 0) {
      warnings.push(
        'ROAS_INFLATION_RISK: V5_SEAL primary + V2/V3 primary on same site. ' +
        'Mark these as secondary in Google Ads UI and in config: ' +
        inflatingActions.map(([k]) => k).join(', ')
      );
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Config (fallback for legacy / unconfig'd sites)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SITE_EXPORT_CONFIG: SiteExportConfig = SiteExportConfigSchema.parse({});
