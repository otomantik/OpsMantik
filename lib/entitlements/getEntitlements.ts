/**
 * Sprint-1 Titanium Core: Server-only entitlements fetcher.
 * Fail-closed: on RPC error or invalid shape, returns FREE_FALLBACK (all false, 0).
 *
 * Modes:
 * - Launch mode: Production with OPSMANTIK_ENTITLEMENTS_STRICT unset or false => all sites get
 *   PRO_FULL_ENTITLEMENTS (no 429 from monthly_revenue_events). Use for initial launch.
 * - Tiered mode: Set OPSMANTIK_ENTITLEMENTS_STRICT=true in production when subscriptions are ready;
 *   then run subscription/usage backfill and verify. Enforces DB-driven limits.
 * - OPSMANTIK_ENTITLEMENTS_FULL_ACCESS=true => always PRO_FULL_ENTITLEMENTS (any env).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { parseEntitlements, FREE_FALLBACK, PRO_FULL_ENTITLEMENTS, type Entitlements } from './types';

/** When true, getEntitlements returns PRO_FULL_ENTITLEMENTS (unlimited revenue_events, etc.). Server-only. */
const EXPLICIT_FULL_ACCESS = process.env.OPSMANTIK_ENTITLEMENTS_FULL_ACCESS === 'true';
/** In production we default to full access so sync/queue never block on subscription limits. Set OPSMANTIK_ENTITLEMENTS_STRICT=true to use DB subscriptions. */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STRICT_ENTITLEMENTS = process.env.OPSMANTIK_ENTITLEMENTS_STRICT === 'true';
const FULL_ACCESS = EXPLICIT_FULL_ACCESS || (IS_PRODUCTION && !STRICT_ENTITLEMENTS);

let entitlementsFullAccessWarned = false;

/**
 * Get entitlements for a site. Use adminClient when no user context (e.g. sync route).
 * On error or invalid response, returns FREE_FALLBACK so the app never crashes and remains secure.
 * Production: defaults to PRO_FULL_ENTITLEMENTS (no 429 from monthly_revenue_events). Set OPSMANTIK_ENTITLEMENTS_STRICT=true to enforce DB subscriptions.
 */
export async function getEntitlements(
  siteId: string,
  supabaseClient?: SupabaseClient
): Promise<Entitlements> {
  if (FULL_ACCESS) {
    if (IS_PRODUCTION && !STRICT_ENTITLEMENTS && !entitlementsFullAccessWarned) {
      entitlementsFullAccessWarned = true;
      logWarn('ENTITLEMENTS_FULL_ACCESS', {
        message: 'Production running with full access; set OPSMANTIK_ENTITLEMENTS_STRICT=true to enforce tiers',
      });
    }
    return PRO_FULL_ENTITLEMENTS;
  }
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
