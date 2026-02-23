/**
 * Sprint-1 Titanium Core: Canonical entitlements contract.
 * Source of truth for tier + capabilities + limits. RPC get_entitlements_for_site returns this shape.
 */

export type Tier = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY' | 'SUPER_ADMIN';

export type CapabilityKey =
  | 'dashboard_live_queue'
  | 'dashboard_traffic_widget'
  | 'csv_export'
  | 'oci_upload'
  | 'full_attribution_history'
  | 'ai_cro_insights'
  | 'superadmin_god_mode'
  | 'agency_portfolio';

export interface EntitlementsLimits {
  visible_queue_items: number;
  history_days: number;
  monthly_revenue_events: number;
  monthly_oci_uploads: number;
}

export interface Entitlements {
  tier: Tier;
  capabilities: Record<CapabilityKey, boolean>;
  limits: EntitlementsLimits;
}

/** Fail-closed: when RPC fails or shape invalid, return this (all false, 0). Never grants access. */
export const FREE_FALLBACK: Entitlements = {
  tier: 'FREE',
  capabilities: {
    dashboard_live_queue: false,
    dashboard_traffic_widget: false,
    csv_export: false,
    oci_upload: false,
    full_attribution_history: false,
    ai_cro_insights: false,
    superadmin_god_mode: false,
    agency_portfolio: false,
  },
  limits: {
    visible_queue_items: 0,
    history_days: 0,
    monthly_revenue_events: 0,
    monthly_oci_uploads: 0,
  },
};

/** Production override: all capabilities on, unlimited limits. Set OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true in prod. */
export const PRO_FULL_ENTITLEMENTS: Entitlements = {
  tier: 'PRO',
  capabilities: {
    dashboard_live_queue: true,
    dashboard_traffic_widget: true,
    csv_export: true,
    oci_upload: true,
    full_attribution_history: true,
    ai_cro_insights: true,
    superadmin_god_mode: false,
    agency_portfolio: true,
  },
  limits: {
    visible_queue_items: 500,
    history_days: 365,
    monthly_revenue_events: -1,
    monthly_oci_uploads: -1,
  },
};

const CAPABILITY_KEYS: CapabilityKey[] = [
  'dashboard_live_queue',
  'dashboard_traffic_widget',
  'csv_export',
  'oci_upload',
  'full_attribution_history',
  'ai_cro_insights',
  'superadmin_god_mode',
  'agency_portfolio',
];

/** Parse RPC jsonb into Entitlements. Returns null if shape invalid. */
export function parseEntitlements(raw: unknown): Entitlements | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const tier = o.tier as string | undefined;
  if (!tier || !['FREE', 'STARTER', 'PRO', 'AGENCY', 'SUPER_ADMIN'].includes(tier)) return null;
  const caps = o.capabilities as Record<string, unknown> | undefined;
  const limits = o.limits as Record<string, unknown> | undefined;
  if (!caps || typeof caps !== 'object' || !limits || typeof limits !== 'object') return null;
  const capabilities: Record<CapabilityKey, boolean> = {} as Record<CapabilityKey, boolean>;
  for (const k of CAPABILITY_KEYS) {
    capabilities[k] = caps[k] === true;
  }
  const visible_queue_items = Number(limits.visible_queue_items);
  const history_days = Number(limits.history_days);
  const monthly_revenue_events = Number(limits.monthly_revenue_events);
  const monthly_oci_uploads = Number(limits.monthly_oci_uploads);
  if (!Number.isInteger(visible_queue_items) || !Number.isInteger(history_days) || !Number.isInteger(monthly_revenue_events) || !Number.isInteger(monthly_oci_uploads)) {
    return null;
  }
  return {
    tier: tier as Tier,
    capabilities,
    limits: {
      visible_queue_items,
      history_days,
      monthly_revenue_events,
      monthly_oci_uploads,
    },
  };
}
