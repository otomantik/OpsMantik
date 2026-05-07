/**
 * Outbox processor — claims PENDING IntentSealed rows (FOR UPDATE SKIP LOCKED),
 * processes each using canonical stages, then marks PROCESSED or FAILED.
 *
 * Extracted from app/api/cron/oci/process-outbox-events/route.ts during
 * Phase 4 f4-notify-outbox so both cron polling and QStash-triggered
 * webhook paths share the same logic.
 */

import { adminClient } from '@/lib/supabase/admin';
import { PipelineStage } from '@/lib/oci/signal-types';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { enqueueOciConversionRow } from '@/lib/oci/enqueue-oci-conversion-row';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import {
  isCallSendableForSealExport,
  isCallSendableForOutboxSignalStage,
} from '@/lib/oci/call-sendability';
import { resolveOptimizationStage } from '@/lib/oci/optimization-contract';
import {
  getSingleConversionGearRank,
  pickHighestPriorityGear,
  type SingleConversionGear,
} from '@/lib/oci/single-conversion-highest-only';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { normalizeOciConversionTimeUtcZ, safeValidateOciPayload } from '@/lib/oci/validation/payload';
import { fetchCallSendabilityContext } from '@/lib/oci/call-sendability-fetch';
import { isWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';

function formatOutboxCaughtError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

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
  if (
    params.status === 'FAILED' &&
    typeof params.lastError === 'string' &&
    params.lastError.includes('OCI_CONTRACT_VIOLATION')
  ) {
    incrementRefactorMetric('oci_outbox_contract_violation_total');
  }
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
  /** RPC explicit stage — junk dahil (score çözümlemesi junk üretmeyebilir). */
  stage?: SingleConversionGear | 'junk' | null;
  confirmed_at: string;
  created_at?: string | null;
  sale_occurred_at?: string | null;
  sale_source_timestamp?: string | null;
  sale_time_confidence?: string | null;
  sale_occurred_at_source?: string | null;
  sale_entry_reason?: string | null;
  sale_amount: number | null;
  currency: string;
  matched_fingerprint?: string | null;
  uncertainty_bit?: boolean | null;
}

function resolveOutboxStage(score: number): SingleConversionGear | 'junk' | null {
  const stage = resolveOptimizationStage({ leadScore: score });
  if (stage === 'contacted' || stage === 'offered' || stage === 'won') {
    return stage;
  }
  if (stage === 'junk') {
    return 'junk';
  }
  return null;
}

const ACTIVE_QUEUE_DUP_STATUSES = new Set([
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'UPLOADED',
  'BLOCKED_PRECEDING_SIGNALS',
]);

function resolveGearFromQueueRow(row: {
  optimization_stage?: string | null;
}): SingleConversionGear | 'junk' | null {
  const optimizationStage = (row.optimization_stage ?? '').trim().toLowerCase();
  if (
    optimizationStage === 'contacted' ||
    optimizationStage === 'offered' ||
    optimizationStage === 'won'
  ) {
    return optimizationStage as SingleConversionGear;
  }
  if (optimizationStage === 'junk') {
    return 'junk';
  }
  return null;
}

function resolveSignalStageFromExisting(params: {
  signalType?: string | null;
  optimizationStage?: string | null;
}): SingleConversionGear | 'junk' | null {
  // Input is already normalized by producers to English canonical. We still
  // lowercase + trim to defend against accidental header-case drift.
  const optimizationStage = (params.optimizationStage ?? '').trim().toLowerCase();
  if (
    optimizationStage === 'contacted' ||
    optimizationStage === 'offered' ||
    optimizationStage === 'won' ||
    optimizationStage === 'junk'
  ) {
    return optimizationStage as SingleConversionGear | 'junk';
  }

  const signalType = (params.signalType ?? '').trim().toLowerCase();
  if (signalType === 'contacted' || signalType === 'offered' || signalType === 'won' || signalType === 'junk') {
    return signalType as SingleConversionGear | 'junk';
  }
  return null;
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

    for (const row of (claimed as unknown as { id: string; payload: unknown; call_id: string | null; site_id: string; created_at: string; attempt_count: number }[])) {
      const { id, payload: rawPayload, call_id: callIdFromRow, site_id: siteIdFromRow, created_at: createdAt } = row;
      const payload = rawPayload as OutboxPayload | null;

      // DEEP REPAIR: Temporal Sanity (Eriyen Onarımı)
      // If the event itself or the call is older than 90 days, Google Ads will reject it.
      // We skip these futile attempts early to save resources and avoid API noise.
      if (!isWithinTemporalSanityWindow(createdAt)) {
        logWarn('outbox_event_expired', { outbox_id: id, call_id: callIdFromRow, created_at: createdAt });
        await finalizeOutboxEvent({ 
          outboxId: id, 
          status: 'FAILED', 
          lastError: 'Temporal Sanity Failure: Event is older than 90 days or in the future.' 
        });
        processed++;
        continue;
      }

      const callId = payload?.call_id ?? callIdFromRow;
      const siteId = payload?.site_id ?? siteIdFromRow;
      const leadScore = payload?.lead_score ?? null;
      const explicitStage = payload?.stage ?? null; // Explicit stage from v2 RPC
      const confirmedAt = payload?.confirmed_at ?? '';
      const saleOccurredAt = payload?.sale_occurred_at ?? null;
      const saleSourceTs = payload?.sale_source_timestamp ?? null;
      const payloadCreatedAt = payload?.created_at ?? null;
      const saleAmount = payload?.sale_amount ?? null;
      const currency = normalizeCurrencyOrNeutral(payload?.currency);

      try {
        const { status: callStatus, oci_status: ociStatus } =
          callId && siteId
            ? await fetchCallSendabilityContext(callId, siteId)
            : { status: null as string | null, oci_status: null as string | null };

        let conversionTimeUtcZ =
          normalizeOciConversionTimeUtcZ(confirmedAt) ??
          normalizeOciConversionTimeUtcZ(saleOccurredAt ?? '') ??
          normalizeOciConversionTimeUtcZ(saleSourceTs ?? '') ??
          normalizeOciConversionTimeUtcZ(payloadCreatedAt ?? '');
        if (!conversionTimeUtcZ && callId && siteId) {
          const { data: tsRow } = await adminClient
            .from('calls')
            .select('confirmed_at, matched_at, created_at')
            .eq('id', callId)
            .eq('site_id', siteId)
            .maybeSingle();
          const row = tsRow as {
            confirmed_at?: string | null;
            matched_at?: string | null;
            created_at?: string | null;
          } | null;
          conversionTimeUtcZ =
            normalizeOciConversionTimeUtcZ(row?.confirmed_at) ??
            normalizeOciConversionTimeUtcZ(row?.matched_at) ??
            normalizeOciConversionTimeUtcZ(row?.created_at);
        }

        const score = leadScore ?? 0;
        const stage = explicitStage ?? resolveOutboxStage(score);

        if (!stage) {
          logInfo('outbox_score_too_low', { outbox_id: id, score, message: 'Ignoring junk or low-interest click' });
          await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
          processed++;
          continue;
        }

        if (stage === 'won') {
          if (!isCallSendableForSealExport(callStatus, ociStatus)) {
            await finalizeOutboxEvent({
              outboxId: id,
              status: 'FAILED',
              lastError: 'CALL_NOT_SENDABLE_FOR_OCI',
            });
            failed++;
            continue;
          }
        } else if (stage === 'contacted' || stage === 'offered' || stage === 'junk') {
          if (!isCallSendableForOutboxSignalStage(callStatus, stage)) {
            await finalizeOutboxEvent({
              outboxId: id,
              status: 'FAILED',
              lastError: 'CALL_NOT_SENDABLE_FOR_OCI_SIGNAL',
            });
            failed++;
            continue;
          }
        } else {
          await finalizeOutboxEvent({
            outboxId: id,
            status: 'FAILED',
            lastError: `UNKNOWN_OUTBOX_STAGE:${String(stage)}`,
          });
          failed++;
          continue;
        }

        if (!conversionTimeUtcZ) {
          logWarn('outbox_validation_failed', {
            outbox_id: id,
            call_id: callId,
            error: 'Missing or unparseable conversion_time (confirmed_at)',
          });
          await finalizeOutboxEvent({
            outboxId: id,
            status: 'FAILED',
            lastError: 'OCI_CONTRACT_VIOLATION: missing_conversion_time',
          });
          failed++;
          continue;
        }

        // --- Zod Validation Guard (Shift-Left Data Integrity) ---
        const primary = await getPrimarySource(siteId!, { callId: callId ?? undefined });
        const validationResult = safeValidateOciPayload({
          click_id: primary?.gclid || primary?.gbraid || primary?.wbraid || 'UNKNOWN_STUB',
          conversion_value: Number(saleAmount ?? 0),
          currency: currency,
          conversion_time: conversionTimeUtcZ,
          site_id: siteId,
          stage: stage,
          gbraid: primary?.gbraid,
          wbraid: primary?.wbraid,
          metadata: { outbox_id: id, call_id: callId },
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
            callId: callId!,
            siteId: siteId!,
            confirmedAt: conversionTimeUtcZ,
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
            .select('id, google_conversion_name, optimization_stage')
            .eq('site_id', siteId!)
            .eq('call_id', callId!)
            .order('created_at', { ascending: false });

          const { data: existingSealQueue } = await adminClient
            .from('offline_conversion_queue')
            .select('id')
            .eq('site_id', siteId!)
            .eq('call_id', callId!)
            .eq('provider_key', 'google_ads')
            .in('status', ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'COMPLETED', 'COMPLETED_UNVERIFIED'])
            .limit(1);

          const { data: existingMicroQueue } = await adminClient
            .from('offline_conversion_queue')
            .select('id, optimization_stage, status')
            .eq('site_id', siteId!)
            .eq('call_id', callId!)
            .eq('provider_key', 'google_ads');

          const existingGears: SingleConversionGear[] = [];
          let existingSignalForRequestedGearId: string | null = null;
          let existingQueueRowForRequestedGearId: string | null = null;

          for (const signal of existingSignals ?? []) {
            const normalized = resolveSignalStageFromExisting({
              signalType: (signal as { signal_type?: string | null }).signal_type ?? null,
              optimizationStage: (signal as { optimization_stage?: string | null }).optimization_stage ?? null,
            });
            if (!normalized) continue;
            if (normalized !== 'junk') {
              existingGears.push(normalized);
            }
            if (normalized === gear && !existingSignalForRequestedGearId) {
              existingSignalForRequestedGearId = (signal as { id?: string | null }).id ?? null;
            }
          }

          for (const qr of existingMicroQueue ?? []) {
            const qGear = resolveGearFromQueueRow(qr as { optimization_stage?: string | null });
            const st = String((qr as { status?: string | null }).status ?? '');
            if (qGear && qGear !== 'junk') {
              existingGears.push(qGear);
            }
            if (
              qGear === gear &&
              ACTIVE_QUEUE_DUP_STATUSES.has(st) &&
              !existingQueueRowForRequestedGearId
            ) {
              existingQueueRowForRequestedGearId = (qr as { id?: string | null }).id ?? null;
            }
          }

          if ((existingSealQueue ?? []).length > 0) {
            existingGears.push('won');
          }

          const highestExistingGear = pickHighestPriorityGear(existingGears);
          
          // DEEP PROFESSIONAL FIX: Junk Reversal (Restatement)
          // If we are processing 'junk' but 'contacted' or 'offered' were already sent,
          // we don't just skip. We need to negate the previous signals to avoid algorithm poisoning.
          const isJunkReversal = gear === 'junk' && highestExistingGear && highestExistingGear !== 'junk';
          
          if (isJunkReversal) {
            logInfo('oci_junk_reversal_triggered', { call_id: callId, site_id: siteId, previous_gear: highestExistingGear });
            // PRO-LEVEL: Create retractions for all previously sent micro-conversions
            // This tells Google Ads to 'ignore' the previous positive signals for this click.
            try {
              for (const prevGear of (existingGears as PipelineStage[])) {
                if (prevGear === 'junk') continue;
                const convName = OPSMANTIK_CONVERSION_NAMES[prevGear];
                const stableOrderId = computeOfflineConversionExternalId({
                  providerKey: 'google_ads',
                  action: convName,
                  callId,
                  sessionId: null,
                });
                await adminClient.from('conversion_adjustments').insert({
                  site_id: siteId!,
                  order_id: stableOrderId!,
                  adjustment_type: 'RETRACTION',
                  status: 'PENDING',
                  conversion_action_name: convName,
                  reason: 'Lead marked as Junk after initial signal',
                  channel: 'phone',
                });
                logInfo('oci_retraction_queued', { call_id: callId, gear: prevGear, order_id: stableOrderId });
              }
            } catch (err) {
              logError('OCI_RETRACTION_QUEUE_FAILED', { error: (err as Error).message, call_id: callId });
            }
          } else if (
            gear !== 'junk' &&
            (gear === 'contacted' || gear === 'offered') &&
            highestExistingGear &&
            getSingleConversionGearRank(highestExistingGear) >= getSingleConversionGearRank(gear)
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

          if (existingSignalForRequestedGearId || existingQueueRowForRequestedGearId) {
            logInfo('outbox_signal_skip_already_exists', {
              outbox_id: id,
              call_id: callId,
              gear,
              existing_signal_id: existingSignalForRequestedGearId,
              existing_queue_id: existingQueueRowForRequestedGearId,
            });
            await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
            processed++;
            continue;
          }

          const signalDate = new Date(conversionTimeUtcZ);

          const journalResult = await enqueueOciConversionRow({
            siteId: siteId!,
            callId: callId!,
            stage: gear as 'contacted' | 'offered' | 'junk',
            signalDate,
            intentCreatedAt: payload?.created_at ?? null,
            leadScore: score,
            currency,
            sourceOutboxEventId: id,
            gclid: primary?.gclid ?? null,
            wbraid: primary?.wbraid ?? null,
            gbraid: primary?.gbraid ?? null,
          });

          if (!journalResult.enqueued && journalResult.reason === 'error') {
            throw new Error(journalResult.error ? `ENQUEUE_OCI_ROW_FAILED:${journalResult.error}` : 'ENQUEUE_OCI_ROW_FAILED');
          }

          if (journalResult.enqueued) {
            await appendFunnelEvent({
              callId: callId!,
              siteId: siteId!,
              eventType: gear as PipelineStage,
              eventSource: 'OUTBOX_CRON',
              idempotencyKey: `${gear}:call:${callId}:source:outbox_cron`,
              occurredAt: signalDate,
              payload: {},
              causationId: id,
            });
            logInfo('outbox_journal_emitted', {
              outbox_id: id,
              call_id: callId,
              gear,
              score,
              queue_id: journalResult.queueId,
            });
          }
        } else {
          logInfo('outbox_score_too_low', { outbox_id: id, score, message: 'Ignoring junk or low-interest click' });
        }

        await finalizeOutboxEvent({ outboxId: id, status: 'PROCESSED' });
        processed++;
      } catch (err) {
        const msg = formatOutboxCaughtError(err);
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
    const msg = formatOutboxCaughtError(err);
    logError('process_outbox_error', { error: msg });
    return { ok: false, claimed: 0, processed: 0, failed: 0, error: msg };
  }
}
