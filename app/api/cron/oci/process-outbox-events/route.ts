/**
 * GET/POST /api/cron/oci/process-outbox-events
 *
 * Phase 1 Outbox worker: claims PENDING IntentSealed rows (FOR UPDATE SKIP LOCKED),
 * processes each in memory (V3/V4 → marketing_signals, V5 → offline_conversion_queue),
 * then marks PROCESSED or FAILED.
 *
 * Auth: requireCronAuth (Bearer CRON_SECRET / x-vercel-cron).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';
import { evaluateAndRouteSignal } from '@/lib/domain/mizan-mantik';
import { OpsGear } from '@/lib/domain/mizan-mantik/types';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { isCallSendableForSealExport } from '@/lib/oci/call-sendability';

/**
 * Resolve the true click date for a call.
 * Uses session.created_at (when the visitor first landed with a click ID).
 * Falls back to call.created_at if session is not available.
 *
 * Reason: call.created_at is when the phone rang, not when the user clicked the ad.
 * Using call.created_at inflates decay days and produces incorrect conversion values.
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

export const runtime = 'nodejs';

const BATCH_LIMIT = 50;
// Separate from OCI queue MAX_RETRY_ATTEMPTS (7) — outbox events get fewer retries.
const OUTBOX_MAX_ATTEMPTS = 5;
const EXISTING_FUNNEL_SIGNAL_TYPES = ['MEETING_BOOKED', 'SEAL_PENDING', 'V3_ENGAGE', 'V4_INTENT'] as const;

function normalizeExistingFunnelSignalType(signalType: string | null | undefined): 'V3_ENGAGE' | 'V4_INTENT' | null {
  if (signalType === 'MEETING_BOOKED' || signalType === 'V3_ENGAGE') return 'V3_ENGAGE';
  if (signalType === 'SEAL_PENDING' || signalType === 'V4_INTENT') return 'V4_INTENT';
  return null;
}

/**
 * Maps an OpsGear to its legacy marketing_signals.signal_type value.
 * Inverse of normalizeExistingFunnelSignalType — centralised to avoid drift.
 */
function gearToLegacySignalType(gear: OpsGear): 'SEAL_PENDING' | 'MEETING_BOOKED' | 'INTENT_CAPTURED' {
  if (gear === 'V4_INTENT') return 'SEAL_PENDING';
  if (gear === 'V3_ENGAGE') return 'MEETING_BOOKED';
  return 'INTENT_CAPTURED';
}

interface OutboxPayload {
  call_id: string;
  site_id: string;
  lead_score: number | null;
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

async function runProcessOutbox() {
  try {
    const { data: rows, error: claimError } = await adminClient.rpc('claim_outbox_events', {
      p_limit: BATCH_LIMIT,
    });

    if (claimError) {
      logError('process_outbox_claim_failed', { error: claimError.message });
      return NextResponse.json(
        { ok: false, error: claimError.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const claimed = Array.isArray(rows) ? rows : [];
    if (claimed.length === 0) {
      return NextResponse.json(
        { ok: true, processed: 0, message: 'no_pending_events' },
        { status: 200, headers: getBuildInfoHeaders() }
      );
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
      const confirmedAt = payload?.confirmed_at ?? '';
      const saleOccurredAt = payload?.sale_occurred_at ?? null;
      const saleAmount = payload?.sale_amount ?? null;
      const currency = (payload?.currency ?? 'TRY').trim() || 'TRY';

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
          await adminClient
            .from('outbox_events')
            .update({
              status: 'FAILED',
              last_error: 'CALL_NOT_SENDABLE_FOR_OCI',
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          failed++;
          continue;
        }

        const score = leadScore ?? 0;
        if (score >= 90) {
          // Phase 2.2: Temporal Funnel Backfill (V5 case)
          const { data: existingSignals } = await adminClient
            .from('marketing_signals')
            .select('signal_type')
            .eq('call_id', callId)
            .in('signal_type', [...EXISTING_FUNNEL_SIGNAL_TYPES]);

          const existingTypes = new Set(
            (existingSignals ?? [])
              .map((s) => normalizeExistingFunnelSignalType((s as { signal_type?: string | null }).signal_type))
              .filter((value): value is 'V3_ENGAGE' | 'V4_INTENT' => Boolean(value))
          );
          const primary = await getPrimarySource(siteId, { callId });
          // callCreatedAt is when the phone rang — NOT the real click date.
          // Use getSessionClickDate to resolve the true click date (session.created_at).
          // Fallback to callCreatedAt if session is unavailable.
          const callCreatedAt = new Date(payload?.created_at ?? confirmedAt);
          const callConfirmedAt = new Date(confirmedAt);
          // Resolve true click date for accurate decay calculation
          const v5BackfillClickDate = await getSessionClickDate(callId, callCreatedAt);

          // Sequential Injection
          if (!existingTypes.has('V3_ENGAGE')) {
            await evaluateAndRouteSignal('V3_ENGAGE', {
              siteId,
              callId,
              gclid: primary?.gclid ?? null,
              wbraid: primary?.wbraid ?? null,
              gbraid: primary?.gbraid ?? null,
              aov: 0,
              clickDate: v5BackfillClickDate,
              signalDate: callCreatedAt,
            });
            try {
              await appendFunnelEvent({
                callId,
                siteId,
                eventType: 'V3_QUALIFIED',
                eventSource: 'OUTBOX_CRON',
                idempotencyKey: `v3:call:${callId}:source:outbox_cron`,
                occurredAt: callCreatedAt,
                payload: {},
                causationId: id,
              });
            } catch (ledgerErr) {
              logWarn('FUNNEL_LEDGER_V3_APPEND_FAILED', { call_id: callId, error: (ledgerErr as Error)?.message });
            }
            logInfo('outbox_funnel_backfill_v3', { call_id: callId });
          }

          if (!existingTypes.has('V4_INTENT')) {
            await evaluateAndRouteSignal('V4_INTENT', {
              siteId,
              callId,
              gclid: primary?.gclid ?? null,
              wbraid: primary?.wbraid ?? null,
              gbraid: primary?.gbraid ?? null,
              aov: 0,
              clickDate: v5BackfillClickDate,
              signalDate: callConfirmedAt,
            });
            try {
              await appendFunnelEvent({
                callId,
                siteId,
                eventType: 'V4_INTENT',
                eventSource: 'OUTBOX_CRON',
                idempotencyKey: `v4:call:${callId}:source:outbox_cron`,
                occurredAt: callConfirmedAt,
                payload: {},
                causationId: id,
              });
            } catch (ledgerErr) {
              logWarn('FUNNEL_LEDGER_V4_APPEND_FAILED', { call_id: callId, error: (ledgerErr as Error)?.message });
            }
            logInfo('outbox_funnel_backfill_v4', { call_id: callId });
          }

          const result = await enqueueSealConversion({
            callId,
            siteId,
            confirmedAt,
            saleOccurredAt,
            saleAmount,
            currency,
            leadScore,
            entryReason: payload?.sale_entry_reason ?? null,
          });
          if (result.enqueued) {
            logInfo('outbox_v5_enqueued', { outbox_id: id, call_id: callId, queue_id: result.queueId });
          }
        } else if (score >= 10) {
          // Threshold Banding for V2, V3, V4
          // NOTE: Must mirror seal API thresholds (seal/route.ts:255)
          // V4: score >= 80  (Sicak Teklif)
          // V3: score >= 60  (Nitelikli Gorusme)
          // V2: score >= 10  (Ilk Temas)
          let gear: OpsGear = 'V2_PULSE';
          if (score >= 80) gear = 'V4_INTENT';
          else if (score >= 60) gear = 'V3_ENGAGE';

          // Dedup guard: the seal route writes V3/V4 signals directly via the LCV engine
          // (high-quality, real-time path). Skip if already written to avoid double-counting.
          const legacySignalType = gearToLegacySignalType(gear);
          const { data: existingSignalRow } = await adminClient
            .from('marketing_signals')
            .select('id')
            .eq('site_id', siteId)
            .eq('call_id', callId)
            .eq('signal_type', legacySignalType)
            .limit(1)
            .maybeSingle();
          if (existingSignalRow) {
            logInfo('outbox_signal_skip_already_exists', {
              outbox_id: id,
              call_id: callId,
              gear,
              existing_signal_id: (existingSignalRow as { id: string }).id,
            });
            await adminClient
              .from('outbox_events')
              .update({ status: 'PROCESSED', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', id);
            processed++;
            continue;
          }

          const callCreatedAt = payload?.created_at ?? confirmedAt;
          const primary = await getPrimarySource(siteId, { callId });
          // Use session.created_at as the true click date (when the visitor landed with gclid/wbraid).
          // call.created_at is when the phone rang — potentially days after the original click.
          const callCreatedAtDate = new Date(callCreatedAt);
          const clickDate = await getSessionClickDate(callId, callCreatedAtDate);
          const signalDate = new Date(confirmedAt);

          const result = await evaluateAndRouteSignal(gear, {
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
            const eventType = gear === 'V2_PULSE' ? 'V2_CONTACT' : gear === 'V3_ENGAGE' ? 'V3_QUALIFIED' : 'V4_INTENT';
            const keyPrefix = gear === 'V2_PULSE' ? 'v2' : gear === 'V3_ENGAGE' ? 'v3' : 'v4';
            try {
              await appendFunnelEvent({
                callId,
                siteId,
                eventType,
                eventSource: 'OUTBOX_CRON',
                idempotencyKey: `${keyPrefix}:call:${callId}:source:outbox_cron`,
                occurredAt: signalDate,
                payload: {},
                causationId: id,
              });
            } catch (ledgerErr) {
              logWarn('FUNNEL_LEDGER_APPEND_FAILED', { call_id: callId, gear, error: (ledgerErr as Error)?.message });
            }
            logInfo('outbox_signal_emitted', { outbox_id: id, call_id: callId, gear, score });
          }
        } else {
          logInfo('outbox_score_too_low', { outbox_id: id, score, message: 'Ignoring junk or low-interest click' });
        }

        await adminClient
          .from('outbox_events')
          .update({ status: 'PROCESSED', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError('outbox_process_failed', { outbox_id: id, call_id: callId, error: msg });
        errors.push(`${id}: ${msg}`);
        failed++;

        const attemptCount = (row as { attempt_count?: number }).attempt_count ?? 0;
        const nextAttemptCount = attemptCount + 1;
        const nextStatus = nextAttemptCount >= OUTBOX_MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
        await adminClient
          .from('outbox_events')
          .update({
            status: nextStatus,
            attempt_count: nextAttemptCount,
            last_error: msg.slice(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        claimed: claimed.length,
        processed,
        failed,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      },
      { status: 200, headers: getBuildInfoHeaders() }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('process_outbox_error', { error: msg });
    return NextResponse.json(
      { ok: false, error: msg, code: 'PROCESS_OUTBOX_ERROR' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runProcessOutbox();
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runProcessOutbox();
}
