/**
 * Tenant entitlement gate: fail-closed if the site does not have the required module.
 * Use in API routes before returning feature-specific data.
 */

import { createClient } from '@/lib/supabase/server';
import type { OpsMantikModule } from '@/lib/types/modules';
import type { SiteRow } from '@/lib/types/database';

export class ModuleNotEnabledError extends Error {
  readonly code = 'MODULE_NOT_ENABLED';
  constructor(
    public readonly siteId: string,
    public readonly requiredModule: OpsMantikModule
  ) {
    super(`Site ${siteId} does not have module "${requiredModule}" enabled.`);
    this.name = 'ModuleNotEnabledError';
  }
}

/**
 * Returns true if the site has the given module in active_modules.
 */
export function hasModule(site: { active_modules?: string[] | null }, module: OpsMantikModule): boolean {
  const modules = site.active_modules;
  if (!Array.isArray(modules)) return false;
  return modules.includes(module);
}

export interface RequireModuleParams {
  siteId: string;
  requiredModule: OpsMantikModule;
  site?: SiteRow | { id: string; active_modules?: string[] | null } | null;
}

/**
 * Ensures the site has the required module. If not, throws ModuleNotEnabledError.
 * Call from API routes; catch and return 403 with getBuildInfoHeaders().
 *
 * @param params.siteId - Site UUID
 * @param params.requiredModule - Module required (e.g. 'google_ads_spend')
 * @param params.site - Optional pre-fetched site; if provided, no DB call
 */
export async function requireModule(params: RequireModuleParams): Promise<void> {
  const { siteId, requiredModule, site: siteParam } = params;

  if (siteParam && siteParam.id === siteId) {
    if (hasModule(siteParam, requiredModule)) return;
    throw new ModuleNotEnabledError(siteId, requiredModule);
  }

  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from('sites')
    .select('id, active_modules')
    .eq('id', siteId)
    .maybeSingle();

  if (error || !site) {
    throw new ModuleNotEnabledError(siteId, requiredModule);
  }

  if (hasModule(site, requiredModule)) return;
  throw new ModuleNotEnabledError(siteId, requiredModule);
}
