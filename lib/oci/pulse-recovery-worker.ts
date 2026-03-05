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
import { logInfo, logWarn } from '@/lib/logging/logger';


const BACKOFF_HOURS = [2, 6, 24] as const; // 1st retry after 2h, 2nd after 6h, 3rd after 24h
const MAX_RECOVERY_ATTEMPTS = 3;
const BATCH_LIMIT = 100;

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
}> {
  const now = new Date();
  let processed = 0;
  let recovered = 0;
  let attempted = 0;
  let exhausted = 0;

  const { data: signals, error } = await adminClient
    .from('marketing_signals')
    .select('id, site_id, call_id, google_conversion_time, recovery_attempt_count, last_recovery_attempt_at, gclid, wbraid, gbraid')
    .eq('dispatch_status', 'PENDING')
    .lt('recovery_attempt_count', MAX_RECOVERY_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    logWarn('pulse_recovery_fetch_failed', { error: error.message });
    return { processed: 0, recovered: 0, attempted: 0, exhausted: 0 };
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

  if (due.length === 0) return { processed: 0, recovered: 0, attempted: 0, exhausted: 0 };

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

  if (processed > 0) {
    logInfo('pulse_recovery_complete', { processed, recovered, attempted, exhausted });
  }
  return { processed, recovered, attempted, exhausted };
}
