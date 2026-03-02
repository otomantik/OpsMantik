/**
 * Helpers for PR-T1.1–T1.3 DB-level integration tests (strict ingest).
 * Env-gated: use getStrictTestSiteId() and requireStrictEnv() so tests skip when env is missing.
 */

import { adminClient } from '@/lib/supabase/admin';

const TEST_SITE_ID_KEY = 'STRICT_INGEST_TEST_SITE_ID';
const SUPABASE_URL_KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

export function getStrictTestSiteId(): string | null {
  const id = process.env[TEST_SITE_ID_KEY]?.trim();
  return id || null;
}

export function hasStrictIngestEnv(): boolean {
  return (
    !!process.env[SUPABASE_URL_KEY] &&
    !!process.env[SUPABASE_SERVICE_KEY]
  );
}

/**
 * Return { skip: true, reason } when STRICT_INGEST_TEST_SITE_ID or Supabase env is missing.
 */
export function requireStrictEnv(): { skip: false } | { skip: true; reason: string } {
  if (!getStrictTestSiteId()) {
    return { skip: true, reason: `${TEST_SITE_ID_KEY} required` };
  }
  if (!hasStrictIngestEnv()) {
    return { skip: true, reason: 'Supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) required' };
  }
  return { skip: false };
}

export type SiteConfigPatch = Record<string, unknown>;

/**
 * Update sites.config for a site. Caller should restore in t.after using the returned previous config.
 */
export async function setSiteConfig(
  siteId: string,
  patch: SiteConfigPatch
): Promise<{ previousConfig: Record<string, unknown> }> {
  const { data: row } = await adminClient
    .from('sites')
    .select('config')
    .eq('id', siteId)
    .single();
  const previousConfig = (row?.config as Record<string, unknown>) ?? {};
  await adminClient
    .from('sites')
    .update({ config: { ...previousConfig, ...patch } })
    .eq('id', siteId);
  return { previousConfig };
}

/**
 * Restore sites.config to a previous state (e.g. from setSiteConfig).
 */
export async function restoreSiteConfig(
  siteId: string,
  config: Record<string, unknown>
): Promise<void> {
  await adminClient.from('sites').update({ config }).eq('id', siteId);
}

/**
 * Delete ingest-related rows for a site (by session_id list and/or idempotency/processed_signals).
 * Use after tests to leave DB clean.
 */
export async function cleanupIngestForSite(
  siteId: string,
  options: {
    sessionIds?: Array<{ id: string; created_month: string }>;
    idempotencyKeys?: string[];
    dedupEventIds?: string[];
  }
): Promise<void> {
  if (options.sessionIds?.length) {
    for (const s of options.sessionIds) {
      await adminClient.from('events').delete().eq('session_id', s.id).eq('session_month', s.created_month);
      await adminClient.from('sessions').delete().eq('id', s.id).eq('created_month', s.created_month);
    }
  }
  if (options.idempotencyKeys?.length) {
    for (const key of options.idempotencyKeys) {
      await adminClient.from('ingest_idempotency').delete().eq('site_id', siteId).eq('idempotency_key', key);
    }
  }
  if (options.dedupEventIds?.length) {
    for (const eid of options.dedupEventIds) {
      await adminClient.from('processed_signals').delete().eq('site_id', siteId).eq('event_id', eid);
    }
  }
}
