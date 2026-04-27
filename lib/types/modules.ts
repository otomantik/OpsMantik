/**
 * Tenant-level feature modules (entitlements). Used for backend gating and UI FeatureGuard.
 */

export const OPSMANTIK_MODULES = [
  'core_oci',
  'scoring_v1',
  'google_ads_spend',
] as const;

export type OpsMantikModule = (typeof OPSMANTIK_MODULES)[number];

export const OPSMANTIK_DEFAULT_MODULES: OpsMantikModule[] = ['core_oci', 'scoring_v1'];

/** In DB `active_modules` we keep legacy `dashboard` plus product defaults so call-event (`core_oci`) works for every new site. */
export const DEFAULT_SITE_ACTIVE_MODULES = ['dashboard', 'core_oci', 'scoring_v1'] as const;

export function ensureDefaultSiteActiveModules(modules: string[] | null | undefined): string[] {
  const out: string[] = Array.isArray(modules) ? [...modules] : [];
  for (const m of DEFAULT_SITE_ACTIVE_MODULES) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

export function isOpsMantikModule(value: string): value is OpsMantikModule {
  return (OPSMANTIK_MODULES as readonly string[]).includes(value);
}
