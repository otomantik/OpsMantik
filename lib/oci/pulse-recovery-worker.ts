/**
 * Self-Healing Pulse (MODULE 2) — Retry PENDING marketing_signals
 *
 * Cron every 30min. Exponential backoff: 2h → 6h → 24h.
 * Re-runs primary source (with Identity Stitcher); if click_id found, persists to signal for next export.
 * Max 3 retries.
 */

import { adminClient } from '@/lib/supabase/admin';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { getPrimarySourceWithDiscovery } from '@/lib/oci/identity-stitcher';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';
import { logInfo, logWarn } from '@/lib/logging/logger';
import { redis } from '@/lib/upstash';
import { getPvDataKey, getPvProcessingKeysForRecovery, getPvQueueKey } from '@/lib/oci/pv-redis';


const BACKOFF_HOURS = [2, 6, 24] as const; // 1st retry after 2h, 2nd after 6h, 3rd after 24h
const MAX_RECOVERY_ATTEMPTS = 3;
const BATCH_LIMIT = 100;
const MISSING_V2_LOOKBACK_HOURS = 48;
const MISSING_V2_BATCH_LIMIT = 100;
const PV_RECOVERY_STALE_MS = 15 * 60 * 1000;
const PV_RECOVERY_BATCH_LIMIT = 200;

function getBackoffMs(attemptIndex: number): number {
  const hours = BACKOFF_HOURS[Math.min(attemptIndex, BACKOFF_HOURS.length - 1)];
  return hours * 60 * 60 * 1000;
}

/**
 * Select PENDING signals due for recovery.
 * Gate: recovery_attempt_count < 3 AND (last_recovery_attempt_at + backoff < now OR never attempted).
 */
export async function runPulseRecovery(): Promise<{
  processed: number;
  recovered: number;
  attempted: number;
  exhausted: number;
  missing_signal_checked: number;
  missing_signal_recovered: number;
  missing_signal_dropped: number;
  pv_checked: number;
  pv_requeued: number;
  pv_dropped: number;
}> {
  const now = new Date();
  let processed = 0;
  let recovered = 0;
  let attempted = 0;
  let exhausted = 0;
  let missingSignalChecked = 0;
  let missingSignalRecovered = 0;
  let missingSignalDropped = 0;
  let pvChecked = 0;
  let pvRequeued = 0;
  let pvDropped = 0;

  const { data: signals, error } = await adminClient
    .from('marketing_signals')
    .select('id, site_id, call_id, google_conversion_time, recovery_attempt_count, last_recovery_attempt_at, gclid, wbraid, gbraid')
    .eq('dispatch_status', 'PENDING')
    .lt('recovery_attempt_count', MAX_RECOVERY_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logWarn('pulse_recovery_fetch_failed', { error: error.message });
    return {
      processed: 0,
      recovered: 0,
      attempted: 0,
      exhausted: 0,
      missing_signal_checked: 0,
      missing_signal_recovered: 0,
      missing_signal_dropped: 0,
      pv_checked: 0,
      pv_requeued: 0,
      pv_dropped: 0,
    };
  }

  const rows = Array.isArray(signals) ? signals : [];
  const due: typeof rows = [];

  for (const row of rows) {
    const count = Number(row.recovery_attempt_count ?? 0);
    const lastAt = row.last_recovery_attempt_at ? new Date(row.last_recovery_attempt_at).getTime() : 0;
    const backoffMs = getBackoffMs(count);
    const nextAllowed = lastAt + backoffMs;
    if (lastAt === 0 || now.getTime() >= nextAllowed) {
      due.push(row);
    }
  }

  if (due.length === 0) {
    const backfill = await recoverMissingV2Signals(now);
    const pvRecovery = await recoverStalePvProcessing(now);
    return {
      processed: 0,
      recovered: 0,
      attempted: 0,
      exhausted: 0,
      missing_signal_checked: backfill.checked,
      missing_signal_recovered: backfill.recovered,
      missing_signal_dropped: backfill.dropped,
      pv_checked: pvRecovery.checked,
      pv_requeued: pvRecovery.requeued,
      pv_dropped: pvRecovery.dropped,
    };
  }

  // Fetch call context for stitcher (caller_phone, fingerprint)
  const callIds = due
    .map((r) => (r as { call_id?: string | null }).call_id)
    .filter((id): id is string => Boolean(id));

  const { data: callsData } = await adminClient
    .from('calls')
    .select('id, caller_phone_e164, matched_fingerprint, confirmed_at, created_at')
    .in('id', callIds);

  const callsByFree = new Map<string, { caller_phone_e164?: string; matched_fingerprint?: string; callTime: string }>();
  for (const c of callsData ?? []) {
    const id = (c as { id: string }).id;
    const confirmed = (c as { confirmed_at?: string }).confirmed_at;
    const created = (c as { created_at?: string }).created_at;
    callsByFree.set(id, {
      caller_phone_e164: (c as { caller_phone_e164?: string }).caller_phone_e164 ?? undefined,
      matched_fingerprint: (c as { matched_fingerprint?: string }).matched_fingerprint ?? undefined,
      callTime: confirmed ?? created ?? new Date().toISOString(),
    });
  }

  for (const row of due) {
    const signalId = (row as { id: string }).id;
    const siteId = (row as { site_id: string }).site_id;
    const callId = (row as { call_id?: string | null }).call_id;
    const hasRowClick = Boolean(
      ((row as { gclid?: string }).gclid ?? '').trim() ||
      ((row as { wbraid?: string }).wbraid ?? '').trim() ||
      ((row as { gbraid?: string }).gbraid ?? '').trim()
    );

    if (hasRowClick) {
      // Already has click_id (from previous recovery), skip
      processed++;
      continue;
    }

    if (!callId) {
      processed++;
      continue;
    }

    const callCtx = callsByFree.get(callId);
    const directSource = await getPrimarySource(siteId, { callId });
    const discovered = await getPrimarySourceWithDiscovery(siteId, directSource, {
      callId,
      callTime: callCtx?.callTime ?? (row as { google_conversion_time?: string }).google_conversion_time ?? new Date().toISOString(),
      callerPhoneE164: callCtx?.caller_phone_e164 ?? null,
      fingerprint: callCtx?.matched_fingerprint ?? null,
    });

    const count = Number((row as { recovery_attempt_count?: number }).recovery_attempt_count ?? 0);
    attempted++;

    if (discovered && (discovered.source.gclid || discovered.source.wbraid || discovered.source.gbraid)) {
      const { error: updateErr } = await adminClient
        .from('marketing_signals')
        .update({
          gclid: discovered.source.gclid ?? null,
          wbraid: discovered.source.wbraid ?? null,
          gbraid: discovered.source.gbraid ?? null,
        })
        .eq('id', signalId)
        .eq('site_id', siteId)
        .eq('dispatch_status', 'PENDING');

      if (updateErr) {
        logWarn('pulse_recovery_update_failed', { signal_id: signalId, error: updateErr.message });
      } else {
        recovered++;
        logInfo('pulse_recovery_recovered', { signal_id: signalId, call_id: callId, method: discovered.discoveryMethod });
      }
    } else {
      const nextCount = count + 1;
      const isExhausted = nextCount >= MAX_RECOVERY_ATTEMPTS;
      const { error: incErr } = await adminClient
        .from('marketing_signals')
        .update({
          recovery_attempt_count: nextCount,
          last_recovery_attempt_at: now.toISOString(),
          ...(isExhausted ? { dispatch_status: 'SKIPPED_NO_CLICK_ID' } : {}),
        })
        .eq('id', signalId)
        .eq('site_id', siteId)
        .eq('dispatch_status', 'PENDING');

      if (incErr) {
        logWarn('pulse_recovery_increment_failed', { signal_id: signalId, error: incErr.message });
      } else if (isExhausted) {
        exhausted++;
      }
    }
    processed++;
  }

  const backfill = await recoverMissingV2Signals(now);
  missingSignalChecked = backfill.checked;
  missingSignalRecovered = backfill.recovered;
  missingSignalDropped = backfill.dropped;
  const pvRecovery = await recoverStalePvProcessing(now);
  pvChecked = pvRecovery.checked;
  pvRequeued = pvRecovery.requeued;
  pvDropped = pvRecovery.dropped;

  if (processed > 0 || missingSignalChecked > 0 || pvChecked > 0) {
    logInfo('pulse_recovery_complete', {
      processed,
      recovered,
      attempted,
      exhausted,
      missing_signal_checked: missingSignalChecked,
      missing_signal_recovered: missingSignalRecovered,
      missing_signal_dropped: missingSignalDropped,
      pv_checked: pvChecked,
      pv_requeued: pvRequeued,
      pv_dropped: pvDropped,
    });
  }
  return {
    processed,
    recovered,
    attempted,
    exhausted,
    missing_signal_checked: missingSignalChecked,
    missing_signal_recovered: missingSignalRecovered,
    missing_signal_dropped: missingSignalDropped,
    pv_checked: pvChecked,
    pv_requeued: pvRequeued,
    pv_dropped: pvDropped,
  };
}

async function recoverStalePvProcessing(
  now: Date
): Promise<{ checked: number; requeued: number; dropped: number }> {
  const { data: sites, error } = await adminClient.from('sites').select('id, public_id');
  if (error) {
    logWarn('pulse_recovery_pv_sites_failed', { error: error.message });
    return { checked: 0, requeued: 0, dropped: 0 };
  }

  let checked = 0;
  let requeued = 0;
  let dropped = 0;

  for (const site of sites ?? []) {
    const siteId = (site as { id: string }).id;
    const publicId = (site as { public_id?: string | null }).public_id ?? null;
    const processingKeys = getPvProcessingKeysForRecovery(siteId, publicId);
    const seenPvIds = new Set<string>();

    for (const processingKey of processingKeys) {
      let ids: unknown[] = [];
      try {
        const rawIds = await redis.lrange(processingKey, 0, PV_RECOVERY_BATCH_LIMIT - 1);
        ids = Array.isArray(rawIds) ? rawIds : [];
      } catch (err) {
        logWarn('pulse_recovery_pv_lrange_failed', {
          processing_key: processingKey,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const rawId of ids) {
        if (typeof rawId !== 'string' || !rawId.trim() || seenPvIds.has(rawId)) continue;
        seenPvIds.add(rawId);
        checked++;

        const pvId = rawId.trim();
        const dataKey = getPvDataKey(pvId);
        const raw = await redis.get(dataKey);

        if (!raw || typeof raw !== 'string') {
          await Promise.all(processingKeys.map((key) => redis.lrem(key, 0, pvId)));
          dropped++;
          continue;
        }

        let payload: { siteId?: string; timestamp?: string } | null = null;
        try {
          payload = JSON.parse(raw) as { siteId?: string; timestamp?: string };
        } catch {
          await Promise.all([redis.del(dataKey), ...processingKeys.map((key) => redis.lrem(key, 0, pvId))]);
          dropped++;
          continue;
        }

        const timestampMs = Date.parse(payload?.timestamp ?? '');
        if (!Number.isFinite(timestampMs) || now.getTime() - timestampMs < PV_RECOVERY_STALE_MS) {
          continue;
        }

        const queueKey = getPvQueueKey((payload?.siteId || siteId).trim());
        await Promise.all([
          ...processingKeys.map((key) => redis.lrem(key, 0, pvId)),
          redis.rpush(queueKey, pvId),
        ]);
        requeued++;
      }
    }
  }

  return { checked, requeued, dropped };
}

async function recoverMissingV2Signals(
  now: Date
): Promise<{ checked: number; recovered: number; dropped: number }> {
  const sinceIso = new Date(now.getTime() - MISSING_V2_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: calls, error } = await adminClient
    .from('calls')
    .select('id, site_id, created_at, matched_fingerprint')
    .eq('status', 'intent')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(MISSING_V2_BATCH_LIMIT);

  if (error) {
    logWarn('pulse_recovery_missing_v2_fetch_failed', { error: error.message });
    return { checked: 0, recovered: 0, dropped: 0 };
  }

  const rows = Array.isArray(calls) ? calls : [];
  if (rows.length === 0) return { checked: 0, recovered: 0, dropped: 0 };

  const callIds = rows.map((row) => row.id);
  const { data: existingSignals, error: existingError } = await adminClient
    .from('marketing_signals')
    .select('call_id')
    .eq('signal_type', 'INTENT_CAPTURED')
    .in('call_id', callIds);

  if (existingError) {
    logWarn('pulse_recovery_missing_v2_existing_failed', { error: existingError.message });
    return { checked: 0, recovered: 0, dropped: 0 };
  }

  const existingCallIds = new Set(
    (existingSignals ?? [])
      .map((row) => (row as { call_id?: string | null }).call_id)
      .filter((id): id is string => Boolean(id))
  );
  const missing = rows.filter((row) => !existingCallIds.has(row.id));

  let checked = 0;
  let recovered = 0;
  let dropped = 0;

  for (const row of missing) {
    checked++;
    const primary = await getPrimarySource(row.site_id, { callId: row.id });
    const signalDate = row.created_at ? new Date(row.created_at) : now;
    const result = await evaluateAndRouteSignal('V2_PULSE', {
      siteId: row.site_id,
      callId: row.id,
      gclid: primary?.gclid ?? null,
      wbraid: primary?.wbraid ?? null,
      gbraid: primary?.gbraid ?? null,
      aov: 0,
      clickDate: signalDate,
      signalDate,
      fingerprint: row.matched_fingerprint ?? null,
      traceId: null,
    });

    if (result.routed) {
      recovered++;
    } else {
      dropped++;
      logWarn('pulse_recovery_missing_v2_not_routed', {
        site_id: row.site_id,
        call_id: row.id,
        dropped: result.dropped ?? false,
        has_gclid: Boolean(primary?.gclid),
        has_wbraid: Boolean(primary?.wbraid),
        has_gbraid: Boolean(primary?.gbraid),
      });
    }
  }

  return { checked, recovered, dropped };
}
