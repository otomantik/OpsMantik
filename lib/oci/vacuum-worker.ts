/**
 * Phase 20: Vacuum — PENDING signals > 15m, retry or STALLED_FOR_HUMAN_AUDIT.
 * Düsseldorf kill-switch: signal lacks gclid + non-TR geo → purge (SKIPPED_NO_CLICK_ID) to prevent DDA poisoning.
 */

import { adminClient } from '@/lib/supabase/admin';
import { applyMarketingSignalDispatchBatch } from '@/lib/oci/marketing-signal-dispatch-kernel';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { getPrimarySourceWithDiscovery } from '@/lib/oci/identity-stitcher';
import { isGhostGeoCity } from '@/lib/geo';
import { logInfo, logWarn } from '@/lib/logging/logger';

const STALE_MINUTES = 15;
const BATCH_LIMIT = 200;

/** Turkish site heuristic (same as orchestrator) */
function isTurkishOnlySite(siteId: string, siteName?: string | null): boolean {
  const name = (siteName ?? '').toLowerCase();
  return (
    name.includes('muratcan') ||
    name.includes('yap') ||
    siteId === 'e0f47012-7dec-11d0-a765-00a0c91e6bf6'
  );
}

export async function runVacuum(): Promise<{
  scanned: number;
  stalled: number;
  purged: number;
}> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
  let scanned = 0;
  let stalled = 0;
  let purged = 0;

  const { data: signals, error } = await adminClient
    .from('marketing_signals')
    .select('id, site_id, call_id, created_at, gclid, wbraid, gbraid')
    .eq('dispatch_status', 'PENDING')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logWarn('vacuum_fetch_failed', { error: error.message });
    return { scanned: 0, stalled: 0, purged: 0 };
  }

  const rows = Array.isArray(signals) ? signals : [];
  scanned = rows.length;
  if (rows.length === 0) return { scanned: 0, stalled: 0, purged: 0 };

  const callIds = rows
    .map((r) => (r as { call_id?: string | null }).call_id)
    .filter((id): id is string => Boolean(id));
  const siteIds = [...new Set(rows.map((r) => (r as { site_id: string }).site_id))];

  const { data: calls } = callIds.length > 0
    ? await adminClient
        .from('calls')
        .select('id, site_id, matched_session_id')
        .in('id', callIds)
        .in('site_id', siteIds)
    : { data: [] };

  const callByCallId = new Map<string, { site_id: string; matched_session_id?: string | null }>();
  for (const c of calls ?? []) {
    const id = (c as { id: string }).id;
    callByCallId.set(id, {
      site_id: (c as { site_id: string }).site_id,
      matched_session_id: (c as { matched_session_id?: string | null }).matched_session_id,
    });
  }

  const { data: sites } = await adminClient
    .from('sites')
    .select('id, name')
    .in('id', siteIds);
  const siteNameById = new Map<string, string>();
  for (const s of sites ?? []) {
    siteNameById.set((s as { id: string }).id, (s as { name?: string }).name ?? '');
  }

  const sessionIds = (calls ?? [])
    .map((c) => (c as { matched_session_id?: string | null }).matched_session_id)
    .filter((id): id is string => Boolean(id));
  const { data: sessions } =
    sessionIds.length > 0
      ? await adminClient.from('sessions').select('id, city, district').in('id', sessionIds)
      : { data: [] };
  const sessionGeoById = new Map<string, { city?: string; district?: string }>();
  for (const sess of sessions ?? []) {
    const id = (sess as { id: string }).id;
    sessionGeoById.set(id, {
      city: (sess as { city?: string }).city ?? undefined,
      district: (sess as { district?: string }).district ?? undefined,
    });
  }

  for (const row of rows) {
    const signalId = (row as { id: string }).id;
    const siteId = (row as { site_id: string }).site_id;
    const callId = (row as { call_id?: string | null }).call_id;
    const hasClickId = Boolean(
      ((row as { gclid?: string }).gclid ?? '').trim() ||
      ((row as { wbraid?: string }).wbraid ?? '').trim() ||
      ((row as { gbraid?: string }).gbraid ?? '').trim()
    );

    if (hasClickId) continue;

    const callInfo = callId ? callByCallId.get(callId) : null;
    const sessionId = callInfo?.matched_session_id;
    const geo = sessionId ? sessionGeoById.get(sessionId) : null;
    const city = geo?.city ?? '';
    const district = geo?.district ?? '';
    const isDusseldorf = isGhostGeoCity(city) || isGhostGeoCity(district);
    const siteName = siteNameById.get(siteId) ?? '';
    const isTurkish = isTurkishOnlySite(siteId, siteName);

    if (isDusseldorf && isTurkish) {
      try {
        const n = await applyMarketingSignalDispatchBatch(adminClient, {
          siteId,
          signalIds: [signalId],
          expectStatus: 'PENDING',
          newStatus: 'SKIPPED_NO_CLICK_ID',
        });
        if (n === 1) {
          purged++;
          logInfo('vacuum_dusseldorf_purge', { signal_id: signalId, site_id: siteId });
        }
      } catch {
        // ignore single-row race
      }
      continue;
    }

    try {
      const n = await applyMarketingSignalDispatchBatch(adminClient, {
        siteId,
        signalIds: [signalId],
        expectStatus: 'PENDING',
        newStatus: 'STALLED_FOR_HUMAN_AUDIT',
      });
      if (n === 1) stalled++;
    } catch {
      // ignore single-row race
    }
  }

  if (scanned > 0) {
    logInfo('vacuum_complete', { scanned, stalled, purged });
  }
  return { scanned, stalled, purged };
}
