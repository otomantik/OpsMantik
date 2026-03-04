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
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';

export const runtime = 'nodejs';

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 5;

interface OutboxPayload {
  call_id: string;
  site_id: string;
  lead_score: number | null;
  confirmed_at: string;
  created_at?: string | null;
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
      const saleAmount = payload?.sale_amount ?? null;
      const currency = (payload?.currency ?? 'TRY').trim() || 'TRY';

      try {
        if (leadScore === 60 || leadScore === 80) {
          const gear = leadScore === 60 ? 'V3_ENGAGE' : 'V4_INTENT';
          const callCreatedAt = payload?.created_at ?? confirmedAt;
          const primary = await getPrimarySource(siteId, { callId });
          const clickDate = new Date(callCreatedAt);
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
            logInfo('outbox_v3v4_emitted', { outbox_id: id, call_id: callId, gear });
          }
        } else if (leadScore === 100) {
          // Phase 2.2: Temporal Funnel Backfill
          // Google Ads ML profile requires gradual funnel signals (V3 -> V4 -> V5).
          // If a direct V5 (Won) comes in, we MUST inject missing V3/V4 if they don't exist.
          const { data: existingSignals } = await adminClient
            .from('marketing_signals')
            .select('signal_type')
            .eq('call_id', callId)
            .in('signal_type', ['V3_ENGAGE', 'V4_INTENT']);

          const existingTypes = new Set(existingSignals?.map(s => s.signal_type) ?? []);
          const primary = await getPrimarySource(siteId, { callId });
          const baseTimeMs = new Date(confirmedAt).getTime();

          // Sequential Injection
          if (!existingTypes.has('V3_ENGAGE')) {
            await evaluateAndRouteSignal('V3_ENGAGE', {
              siteId,
              callId,
              gclid: primary?.gclid ?? null,
              wbraid: primary?.wbraid ?? null,
              gbraid: primary?.gbraid ?? null,
              aov: 0,
              clickDate: new Date(payload?.created_at ?? confirmedAt),
              signalDate: new Date(baseTimeMs - 2000), // T-2000ms
            });
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
              clickDate: new Date(payload?.created_at ?? confirmedAt),
              signalDate: new Date(baseTimeMs - 1000), // T-1000ms
            });
            logInfo('outbox_funnel_backfill_v4', { call_id: callId });
          }

          const result = await enqueueSealConversion({
            callId,
            siteId,
            confirmedAt,
            saleAmount,
            currency,
            leadScore,
          });
          if (result.enqueued) {
            logInfo('outbox_v5_enqueued', { outbox_id: id, call_id: callId, queue_id: result.queueId });
            const isProd =
              process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
            if (isProd && result.queueId) {
              const workerUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}/api/workers/google-ads-oci`
                : process.env.NEXT_PUBLIC_APP_URL
                  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/workers/google-ads-oci`
                  : null;
              if (workerUrl) {
                const cronSecret = process.env.CRON_SECRET;
                void fetch(workerUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
                  },
                }).catch(() => { });
              }
            }
          } else {
            logWarn('outbox_v5_skip', { outbox_id: id, call_id: callId, reason: result.reason });
          }
        }

        await adminClient
          .from('outbox_events')
          .update({ status: 'PROCESSED', processed_at: new Date().toISOString() })
          .eq('id', id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError('outbox_process_failed', { outbox_id: id, call_id: callId, error: msg });
        errors.push(`${id}: ${msg}`);
        failed++;

        const attemptCount = (row as { attempt_count?: number }).attempt_count ?? 1;
        const nextStatus = attemptCount >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
        await adminClient
          .from('outbox_events')
          .update({
            status: nextStatus,
            last_error: msg.slice(0, 1000),
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
