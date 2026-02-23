/**
 * Sprint-1 Titanium Core: Server-only entitlements fetcher.
 * Fail-closed: on RPC error or invalid shape, returns FREE_FALLBACK (all false, 0).
 * Production: set OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true to enable all features (sync, OCI, seal, etc.).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { parseEntitlements, FREE_FALLBACK, PRO_FULL_ENTITLEMENTS, type Entitlements } from './types';

/** When true, getEntitlements returns PRO_FULL_ENTITLEMENTS so all features are on (prod override). Server-only. */
const FULL_ACCESS = process.env.OPSMANTIK_ENTITLEMENTS_FULL_ACCESS === 'true';

/**
 * Get entitlements for a site. Use adminClient when no user context (e.g. sync route).
 * On error or invalid response, returns FREE_FALLBACK so the app never crashes and remains secure.
 * When OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true (e.g. in prod), returns PRO_FULL_ENTITLEMENTS so all functions are enabled.
 */
export async function getEntitlements(
  siteId: string,
  supabaseClient?: SupabaseClient
): Promise<Entitlements> {
  if (FULL_ACCESS) return PRO_FULL_ENTITLEMENTS;
  const client = supabaseClient ?? (await createClient());
  try {
    const { data, error } = await client.rpc('get_entitlements_for_site', {
      p_site_id: siteId,
    });
    if (error) return FREE_FALLBACK;
    const parsed = parseEntitlements(data);
    return parsed ?? FREE_FALLBACK;
  } catch {
    return FREE_FALLBACK;
  }
}

/**
 * Get entitlements using service_role (adminClient). Use in API routes that have no user cookie (e.g. sync, OCI export-batch/ack).
 */
export async function getEntitlementsForSite(siteId: string): Promise<Entitlements> {
  return getEntitlements(siteId, adminClient);
}
