/**
 * Outbox processor — claims PENDING IntentSealed rows (FOR UPDATE SKIP LOCKED),
 * processes each using canonical stages, then marks PROCESSED or FAILED.
 *
 * Extracted from app/api/cron/oci/process-outbox-events/route.ts during
 * Phase 4 f4-notify-outbox so both cron polling and QStash-triggered
 * webhook paths share the same logic.
 */

import { adminClient } from '@/lib/supabase/admin';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';
import { PipelineStage } from '@/lib/domain/mizan-mantik/types';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';
import { resolveOptimizationStage } from '@/lib/oci/optimization-contract';
import {
  getSingleConversionGearRank,
  pickHighestPriorityGear,
  type SingleConversionGear,
} from '@/lib/oci/single-conversion-highest-only';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { safeValidateOciPayload } from '@/lib/oci/validation/payload';

export const OUTBOX_BATCH_LIMIT = 50;
/** Separate from OCI queue MAX_RETRY_ATTEMPTS (7) — outbox events get fewer retries. */
export const OUTBOX_MAX_ATTEMPTS = 5;

async function finalizeOutboxEvent(params: {
  outboxId: string;
  status: 'PROCESSED' | 'FAILED' | 'PENDING';
  lastError?: string | null;
  attemptCount?: number | null;
}) {
  const { error } = await adminClient.rpc('finalize_outbox_event_v1', {
    p_outbox_id: params.outboxId,
    p_status: params.status,
    p_last_error: params.lastError ?? null,
    p_attempt_count: params.attemptCount ?? null,
  });
  if (error) throw error;
}

export interface ProcessOutboxResult {
  ok: boolean;
  claimed: number;
  processed: number;
  failed: number;
  errors?: string[];
  /** Populated when the claim RPC itself errored. */
  error?: string;
  /** Short-circuit reason when nothing to do. */
  message?: 'no_pending_events';
}

interface OutboxPayload {
  call_id: string;
  site_id: string;
  lead_score: number | null;
  stage?: SingleConversionGear | null;
  confirmed_at: string;
  created_at?: string | null;
  sale_occurred_at?: string | null;
  sale_source_timestamp?: string | null;
  sale_time_confidence?: string | null;
  sale_occurred_at_source?: string | null;
  sale_entry_reason?: string | null;
  sale_amount: number | null;
  currency: string;
}

function resolveOutboxStage(score: number): SingleConversionGear | null {
  const stage = resolveOptimizationStage({ leadScore: score });
  return stage;
}

function resolveSignalStageFromExisting(params: {
  signalType?: string | null;
  optimizationStage?: string | null;
}): SingleConversionGear | null {
  // Input is already normalized by producers to English canonical. We still
  // lowercase + trim to defend against accidental header-case drift.
  const optimizationStage = (params.optimizationStage ?? '').trim().toLowerCase();
  if (
    optimizationStage === 'contacted' ||
    optimizationStage === 'offered' ||
    optimizationStage === 'won'
  ) {
    return optimizationStage as SingleConversionGear;
  }

  const signalType = (params.signalType ?? '').trim().toLowerCase();
  if (signalType === 'contacted' || signalType === 'offered' || signalType === 'won') {
    return signalType as SingleConversionGear;
  }
  return null;
}

/**
 * Resolve the true click date for a call. Uses session.created_at (when the
 * visitor first landed with a click ID). Falls back to call.created_at if
 * session is not available. call.created_at is when the phone rang, not when
 * the user clicked the ad — using it inflates decay days and produces
 * incorrect conversion values.
 */
async function getSessionClickDate(callId: string, fallbackDate: Date): Promise<Date> {
  try {
    const { data: callRow } = await adminClient
      .from('calls')
      .select('matched_session_id')
      .eq('id', callId)
      .maybeSingle();

    const sessionId = (callRow as { matched_session_id?: string | null } | null)?.matched_session_id;
    if (!sessionId) return fallbackDate;

    const { data: sessionRow } = await adminClient
      .from('sessions')
      .select('created_at')
      .eq('id', sessionId)
      .maybeSingle();

    const sessionCreatedAt = (sessionRow as { created_at?: string | null } | null)?.created_at;
    if (!sessionCreatedAt) return fallbackDate;

    const parsed = new Date(sessionCreatedAt);
    return isNaN(parsed.getTime()) ? fallbackDate : parsed;
  } catch {
    return fallbackDate;
  }
}

/**
 * Run one batch of the outbox processor. Safe to call concurrently — the DB
 * claim RPC uses FOR UPDATE SKIP LOCKED so each instance owns its rows.
 */
export async function runProcessOutbox(): Promise<ProcessOutboxResult> {
  try {
    const { data: rows, error: claimError } = await adminClient.rpc('claim_outbox_events', {
      p_limit: OUTBOX_BATCH_LIMIT,
    });

    if (claimError) {
      logError('process_outbox_claim_failed', { error: claimError.message });
      return { ok: false, claimed: 0, processed: 0, failed: 0, error: claimError.message };
    }

    const claimed = Array.isArray(rows) ? rows : [];
    if (claimed.length === 0) {
      return { ok: true, claimed: 0, processed: 0, failed: 0, message: 'no_pending_events' };
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of claimed) {
      const id = (row as { id: string }).id;
      const payload = (row as { payload: OutboxPayload }).payload as OutboxPayload;
      const callId = payload?.call_id ?? (row as { call_id: string | null }).call_id;
      const siteId = payload?.site_id ?? (row as { site_id: string }).site_id;
      const leadScore = payload?.lead_score ?? null;
      const explicitStage = payload?.stage ?? null; // Explicit stage from v2 RPC
      const confirmedAt = payload?.confirmed_at ?? '';
      const saleOccurredAt = payload?.sale_occurred_at ?? null;
      const saleAmount = payload?.sale_amount ?? null;
      const currency = normalizeCurrencyOrNeutral(payload?.currency);

      try {
        const { data: currentCall } = await adminClient
          .from('calls')
          .select('status, oci_status')
          .eq('id', callId)
          .eq('site_id', siteId)
          .maybeSingle();
        const callStatus = (currentCall as { status?: string | null } | null)?.status ?? null;
        const ociStatus = (currentCall as { oci_status?: string | null } | null)?.oci_status ?? null;
        if (!isCallSendableForSealExport(callStatus, ociStatus)) {
          await finalizeOutboxEvent({
            outboxId: id,
            status: 'FAILED',
            lastError: 'CALL_NOT_SENDABLE_FOR_OCI',
          });
          failed++;
          continue;
        }

        const score = leadScore ?? 0;
        const stage = explicitStage ?? resolveOutboxStage(score);

        if (!stage) {
          logInfo('outbox_score_too_low', { outbox_id: id, score, message: 'Ignoring junk or low-interest click' });
          await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
          processed++;
          continue;
        }

        // --- Zod Validation Guard (Shift-Left Data Integrity) ---
        const primary = await getPrimarySource(siteId, { callId });
        const validationResult = safeValidateOciPayload({
          click_id: primary?.gclid || primary?.gbraid || primary?.wbraid || 'UNKNOWN_STUB',
          conversion_value: Number(saleAmount ?? 0),
          currency: currency,
          conversion_time: confirmedAt,
          site_id: siteId,
          stage: stage,
          gbraid: primary?.gbraid,
          wbraid: primary?.wbraid,
          metadata: { outbox_id: id, call_id: callId }
        });

        if (!validationResult.success || validationResult.data.click_id === 'UNKNOWN_STUB') {
          const schemaError = !validationResult.success 
            ? validationResult.error.errors.map(e => e.message).join(', ') 
            : 'Missing Click ID (GCLID/GBRAID/WBRAID)';
          
          logWarn('outbox_validation_failed', { 
            outbox_id: id, 
            call_id: callId, 
            error: schemaError 
          });

          await finalizeOutboxEvent({
            outboxId: id,
            status: 'FAILED',
            lastError: `OCI_CONTRACT_VIOLATION: ${schemaError}`,
          });
          failed++;
          continue;
        }
        // --- Validation End ---

        if (stage === 'won') {
          // Single-conversion mode: won suppresses lower stages for this lead.
          const result = await enqueueSealConversion({
            callId,
            siteId,
            confirmedAt,
            saleOccurredAt,
            saleAmount,
            currency,
            leadScore,
            entryReason: payload?.sale_entry_reason ?? null,
            sourceOutboxEventId: id,
          });
          if (!result.enqueued && result.reason === 'error') {
            throw new Error(result.error ? `ENQUEUE_SEAL_FAILED:${result.error}` : 'ENQUEUE_SEAL_FAILED');
          }
          if (result.enqueued) {
            logInfo('outbox_won_enqueued', { outbox_id: id, call_id: callId, queue_id: result.queueId });
          }
        } else if (stage) {
          const gear = stage;
          const { data: existingSignals } = await adminClient
            .from('marketing_signals')
            .select('id, signal_type, optimization_stage')
            .eq('site_id', siteId)
            .eq('call_id', callId)
            .limit(25);

          const { data: existingSealQueue } = await adminClient
            .from('offline_conversion_queue')
            .select('id')
            .eq('site_id', siteId)
            .eq('call_id', callId)
            .eq('provider_key', 'google_ads')
            .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'COMPLETED', 'COMPLETED_UNVERIFIED'])
            .limit(1);

          const existingGears: SingleConversionGear[] = [];
          let existingSignalForRequestedGearId: string | null = null;
          for (const signal of existingSignals ?? []) {
            const normalized = resolveSignalStageFromExisting({
              signalType: (signal as { signal_type?: string | null }).signal_type ?? null,
              optimizationStage: (signal as { optimization_stage?: string | null }).optimization_stage ?? null,
            });
            if (!normalized) continue;
            existingGears.push(normalized);
            if (normalized === gear && !existingSignalForRequestedGearId) {
              existingSignalForRequestedGearId = (signal as { id?: string | null }).id ?? null;
            }
          }
          if ((existingSealQueue ?? []).length > 0) {
            existingGears.push('won');
          }

          const highestExistingGear = pickHighestPriorityGear(existingGears);
          if (
            highestExistingGear &&
            getSingleConversionGearRank(highestExistingGear) > getSingleConversionGearRank(gear)
          ) {
            logInfo('outbox_signal_skip_higher_gear_exists', {
              outbox_id: id,
              call_id: callId,
              requested_gear: gear,
              existing_gear: highestExistingGear,
            });
            await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
            processed++;
            continue;
          }

          if (existingSignalForRequestedGearId) {
            logInfo('outbox_signal_skip_already_exists', {
              outbox_id: id,
              call_id: callId,
              gear,
              existing_signal_id: existingSignalForRequestedGearId,
            });
            await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
            processed++;
            continue;
          }

          const callCreatedAt = payload?.created_at ?? confirmedAt;
          const primary = await getPrimarySource(siteId, { callId });
          const callCreatedAtDate = new Date(callCreatedAt);
          const clickDate = await getSessionClickDate(callId, callCreatedAtDate);
          const signalDate = new Date(confirmedAt);

          const result = await evaluateAndRouteSignal(gear as PipelineStage, {
            siteId,
            callId,
            gclid: primary?.gclid ?? null,
            wbraid: primary?.wbraid ?? null,
            gbraid: primary?.gbraid ?? null,
            aov: 0,
            clickDate,
            signalDate,
          });
          if (result.routed) {
            await appendFunnelEvent({
              callId,
              siteId,
              eventType: gear as PipelineStage,
              eventSource: 'OUTBOX_CRON',
              idempotencyKey: `${gear}:call:${callId}:source:outbox_cron`,
              occurredAt: signalDate,
              payload: {},
              causationId: id,
            });
            logInfo('outbox_signal_emitted', { outbox_id: id, call_id: callId, gear, score });
          }
        } else {
          logInfo('outbox_score_too_low', { outbox_id: id, score, message: 'Ignoring junk or low-interest click' });
        }

        await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError('outbox_process_failed', { outbox_id: id, call_id: callId, error: msg });
        errors.push(`${id}: ${msg}`);
        failed++;

        const attemptCount = (row as { attempt_count?: number }).attempt_count ?? 0;
        const nextStatus = attemptCount >= OUTBOX_MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
        await finalizeOutboxEvent({
          outboxId: id,
          status: nextStatus as 'FAILED' | 'PENDING',
          attemptCount,
          lastError: msg.slice(0, 1000),
        });
      }
    }

    return {
      ok: true,
      claimed: claimed.length,
      processed,
      failed,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('process_outbox_error', { error: msg });
    return { ok: false, claimed: 0, processed: 0, failed: 0, error: msg };
  }
}
