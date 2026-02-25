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

export function isOpsMantikModule(value: string): value is OpsMantikModule {
  return (OPSMANTIK_MODULES as readonly string[]).includes(value);
}
