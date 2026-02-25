/**
 * Sprint 1.6 — Iron Dome: Google Conversion Dispatcher Worker
 *
 * Changes from Sprint 1.5:
 *  - Fetches via RPC `get_pending_conversions_for_worker` (SKIP LOCKED + atomic claim)
 *    → parallel workers never pick the same row
 *  - Exponential backoff on failure: retry_count² × 60 seconds cooldown
 *  - Max-retry parking: after MAX_RETRIES attempts, next_retry_at pushed 1 year ahead
 *  - Uses `google_value` column (canonical value) with fallback to adjustment_value
 *  - crash recovery: if worker dies, claimed_at ages out after 10 min (RPC handles)
 *
 * Credentials: GOOGLE_ADS_CREDENTIALS env (JSON).
 */

import { adminClient } from '@/lib/supabase/admin';
import { googleAdsAdapter } from '@/lib/providers/google_ads/adapter';
import type { ConversionJob } from '@/lib/providers/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_LIMIT = 50;
const MAX_RETRIES = 5;
/** 1 year in ms — used to park permanently failed rows */
const PARK_MS = 365 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversionRow {
    id: string;
    gclid: string | null;
    session_id: string | null;
    visitor_id: string | null;
    star: number | null;
    revenue: number;
    presignal_value: number;
    google_action: 'SEND' | 'RESTATE' | 'RETRACT' | null;
    adjustment_value: number;
    google_value: number | null;       // Sprint 1.6: canonical value column
    retry_count: number;
    next_retry_at: string;
    claimed_at: string | null;
    claimed_by: string | null;
    created_at: string;
}

export interface WorkerResult {
    picked: number;
    processed: number;
    succeeded: number;
    failed: number;
    parked: number;      // rows that hit MAX_RETRIES and are parked
}

// ---------------------------------------------------------------------------
// Credential loader
// ---------------------------------------------------------------------------

function loadCredentials(): unknown {
    const raw = process.env.GOOGLE_ADS_CREDENTIALS?.trim();
    if (!raw) {
        throw new Error('conversion-worker: GOOGLE_ADS_CREDENTIALS env variable is not set');
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error('conversion-worker: GOOGLE_ADS_CREDENTIALS is not valid JSON');
    }
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/**
 * Exponential backoff: delay = retryCount² × 60 seconds.
 * retry 1 → 60s | retry 2 → 240s | retry 3 → 540s | retry 4 → 960s | retry 5 → 1500s
 */
export function computeNextRetryAt(now: Date, nextRetryCount: number): Date {
    const delaySec = Math.pow(nextRetryCount, 2) * 60;
    return new Date(now.getTime() + delaySec * 1000);
}

// ---------------------------------------------------------------------------
// Row → ConversionJob
// ---------------------------------------------------------------------------

/**
 * Maps a conversions row to a ConversionJob.
 * Sprint 1.6: uses google_value column; falls back to adjustment_value.
 */
export function rowToJob(row: ConversionRow): ConversionJob {
    // google_value (Sprint 1.6) takes priority over legacy adjustment_value
    const valueUnits = row.google_value ?? row.adjustment_value ?? 0;
    const valueCents = Math.round(valueUnits * 100);

    return {
        id: row.id,
        site_id: row.session_id ?? row.id,
        provider_key: 'google_ads',
        action_key: row.google_action ?? 'SEND',
        occurred_at: row.created_at ?? new Date().toISOString(),
        amount_cents: valueCents,
        currency: 'TRY',
        click_ids: {
            gclid: row.gclid ?? null,
            wbraid: null,
            gbraid: null,
        },
        payload: {
            conversion_time: row.created_at ?? new Date().toISOString(),
            value_cents: valueCents,
            currency: 'TRY',
            click_ids: {
                gclid: row.gclid ?? null,
                wbraid: null,
                gbraid: null,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Backoff update helper
// ---------------------------------------------------------------------------

async function applyBackoff(rowId: string, currentRetryCount: number, errPayload: Record<string, unknown>): Promise<void> {
    const nextCount = currentRetryCount + 1;
    const nextRetry = computeNextRetryAt(new Date(), nextCount);
    await adminClient
        .from('conversions')
        .update({
            retry_count: nextCount,
            next_retry_at: nextRetry.toISOString(),
            google_response: errPayload,
            updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
}

async function parkRow(rowId: string, reason: string): Promise<void> {
    const parkedUntil = new Date(Date.now() + PARK_MS);
    await adminClient
        .from('conversions')
        .update({
            next_retry_at: parkedUntil.toISOString(),
            google_response: { status: 'error', code: 'MAX_RETRIES', message: reason },
            updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
}

// ---------------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------------

/**
 * Processes pending conversions using SKIP LOCKED RPC (Iron Dome).
 * Safe to run in parallel — no double-send possible.
 */
export async function processPendingConversions(opts?: {
    workerId?: string;
    batchSize?: number;
    maxRetries?: number;
}): Promise<WorkerResult> {
    const workerId = opts?.workerId ?? process.env.WORKER_ID ?? 'worker-1';
    const batchSize = opts?.batchSize ?? BATCH_LIMIT;
    const maxRetries = opts?.maxRetries ?? MAX_RETRIES;
    const nowIso = new Date().toISOString();

    // 1. Fail-fast credential check
    const credentials = loadCredentials();

    // 2. Atomic SKIP LOCKED claim via RPC
    const { data: rows, error: rpcError } = await adminClient.rpc(
        'get_pending_conversions_for_worker',
        { p_batch_size: batchSize, p_current_time: nowIso, p_worker_id: workerId }
    );

    if (rpcError) {
        throw new Error(`conversion-worker: RPC failed — ${rpcError.message}`);
    }

    const claimedRows = (rows ?? []) as ConversionRow[];

    if (claimedRows.length === 0) {
        return { picked: 0, processed: 0, succeeded: 0, failed: 0, parked: 0 };
    }

    // 3. Dispatch
    const jobs: ConversionJob[] = [];
    const validRows: ConversionRow[] = [];
    let parked = 0;

    for (const row of claimedRows) {
        // Max-retry check
        if (row.retry_count >= maxRetries) {
            await parkRow(row.id, `exceeded ${maxRetries} retries`);
            parked++;
            continue;
        }

        // Missing required fields → immediate backoff (don't spin)
        if (!row.google_action || !row.gclid) {
            await applyBackoff(
                row.id,
                row.retry_count,
                { status: 'error', code: 'INVALID_ROW', message: 'Missing google_action or gclid' }
            );
            continue;
        }

        jobs.push(rowToJob(row));
        validRows.push(row);
    }

    if (jobs.length === 0) {
        return { picked: claimedRows.length, processed: 0, succeeded: 0, failed: 0, parked };
    }

    // 4. Adapter dispatch
    let results;
    try {
        results = await googleAdsAdapter.uploadConversions({ jobs, credentials });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // All claimed rows get backoff
        await Promise.allSettled(
            validRows.map((row) =>
                applyBackoff(row.id, row.retry_count, { status: 'error', code: 'ADAPTER_THROW', message })
            )
        );
        return { picked: claimedRows.length, processed: validRows.length, succeeded: 0, failed: validRows.length, parked };
    }

    // 5. Per-row result update
    let succeeded = 0;
    let failed = 0;

    await Promise.allSettled(
        results.map(async (result) => {
            if (result.status === 'COMPLETED') {
                const { error } = await adminClient
                    .from('conversions')
                    .update({
                        google_sent_at: new Date().toISOString(),
                        google_response: { status: 'COMPLETED', provider_ref: result.provider_ref ?? null },
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', result.job_id);

                if (!error) succeeded++;
                else failed++;
            } else {
                // FAILED or RETRY → exponential backoff
                const row = validRows.find((r) => r.id === result.job_id);
                const retryCount = row?.retry_count ?? 0;
                await applyBackoff(result.job_id, retryCount, {
                    status: result.status,
                    error_code: result.error_code ?? null,
                    error_message: result.error_message ?? null,
                    provider_error_category: result.provider_error_category ?? null,
                });
                failed++;
            }
        })
    );

    return {
        picked: claimedRows.length,
        processed: validRows.length,
        succeeded,
        failed,
        parked,
    };
}
