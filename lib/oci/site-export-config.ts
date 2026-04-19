import { z } from 'zod';

export const ConversionActionConfigSchema = z.object({
  action_name: z.string().min(1),
  role: z.enum(['primary', 'secondary']).default('secondary'),
  adjustable: z.boolean().default(false),
});

export type ConversionActionConfig = z.infer<typeof ConversionActionConfigSchema>;

export const EnhancedConversionsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  fallback_identifiers: z.array(
    z.enum(['hashed_phone', 'hashed_email'])
  ).default(['hashed_phone']),
  use_oct_fallback: z.boolean().default(false),
});

export type EnhancedConversionsConfig = z.infer<typeof EnhancedConversionsConfigSchema>;

export type ChannelKey = 'phone' | 'whatsapp' | 'form' | 'ecommerce';

const ChannelKeyEnum = z.enum(['phone', 'whatsapp', 'form', 'ecommerce']);

export const SiteExportConfigSchema = z.object({
  channels: z.array(ChannelKeyEnum).min(1).default(['phone']),
  currency: z.string().length(3).default('USD'),
  timezone: z.string().default('UTC'),
  max_click_age_days: z.number().int().min(1).max(90).default(90),
  require_click_id: z.boolean().default(true),
  export_method: z.enum(['script', 'api']).default('script'),
  script_ack_timeout_minutes: z.number().int().min(5).max(120).default(30),
  enhanced_conversions: EnhancedConversionsConfigSchema.default({
    enabled: false,
    fallback_identifiers: ['hashed_phone'],
    use_oct_fallback: false,
  }),
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

/**
 * Parse a raw `sites.oci_config` JSON blob into a typed, defaulted `SiteExportConfig`.
 *
 * We use Zod's safeParse so that malformed / partial configs fall back to the canonical
 * defaults instead of throwing at request time. Any valid sub-fields the tenant supplied
 * (e.g. custom currency, timezone, enhanced-conversions overrides) are honored.
 */
export function parseExportConfig(raw: unknown): SiteExportConfig {
  if (raw == null) return DEFAULT_SITE_EXPORT_CONFIG;
  const result = SiteExportConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  return DEFAULT_SITE_EXPORT_CONFIG;
}

export function getConversionActionConfig(
  config: SiteExportConfig,
  channel: ChannelKey,
  gear: string
): ConversionActionConfig | null {
  void config;
  void channel;

  switch (gear) {
    case 'contacted':
      return { action_name: 'OpsMantik_Contacted', role: 'primary', adjustable: false };
    case 'offered':
      return { action_name: 'OpsMantik_Offered', role: 'primary', adjustable: false };
    case 'won':
      return { action_name: 'OpsMantik_Won', role: 'primary', adjustable: true };
    case 'junk':
      return { action_name: 'OpsMantik_Junk_Exclusion', role: 'secondary', adjustable: false };
    default:
      return null;
  }
}

export function getActionName(
  config: SiteExportConfig,
  channel: ChannelKey,
  gear: string
): string | null {
  return getConversionActionConfig(config, channel, gear)?.action_name ?? null;
}

export const DEFAULT_SITE_EXPORT_CONFIG: SiteExportConfig = SiteExportConfigSchema.parse({
  channels: ['phone', 'whatsapp', 'form', 'ecommerce'],
  currency: 'USD',
  timezone: 'UTC',
  max_click_age_days: 90,
  require_click_id: true,
  export_method: 'script',
  script_ack_timeout_minutes: 30,
  enhanced_conversions: {
    enabled: false,
    fallback_identifiers: ['hashed_phone'],
    use_oct_fallback: false,
  },
  adjustments: {
    enabled: false,
    supported_types: ['RETRACTION', 'RESTATEMENT'],
    max_adjustment_age_days: 90,
  },
});
