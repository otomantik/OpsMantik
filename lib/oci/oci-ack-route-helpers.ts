import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logError } from '@/lib/logging/logger';
import { applyMarketingSignalDispatchBatch } from '@/lib/oci/marketing-signal-dispatch-kernel';

const MAX_SAFE_ERROR_STRING = 2048;

/** Stringify arbitrary client payloads for DB/text columns — never throws. */
export function safeOciErrorString(value: unknown, maxLen = MAX_SAFE_ERROR_STRING): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().slice(0, maxLen);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, maxLen);
  try {
    return JSON.stringify(value).slice(0, maxLen);
  } catch {
    return '[unserializable-error]'.slice(0, maxLen);
  }
}

export function parseAckJsonEnvelope(rawBody: unknown): { ok: true; body: Record<string, unknown> } | { ok: false } {
  if (Array.isArray(rawBody)) {
    const results = normalizeGranularResultArray(rawBody);
    return { ok: true, body: { results, _normalizedFromArrayBody: true } };
  }
  if (rawBody && typeof rawBody === 'object') {
    return { ok: true, body: rawBody as Record<string, unknown> };
  }
  return { ok: false };
}

function normalizeGranularResultArray(
  arr: unknown[]
): Array<{ id: string; status: 'SUCCESS' | 'FAILED'; reason?: string | null }> {
  const out: Array<{ id: string; status: 'SUCCESS' | 'FAILED'; reason?: string | null }> = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || (rec.status !== 'SUCCESS' && rec.status !== 'FAILED')) continue;
    out.push({
      id: rec.id,
      status: rec.status,
      reason: rec.reason != null ? safeOciErrorString(rec.reason, 256) : null,
    });
  }
  return out;
}

export function normalizeAckFailedBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const o = raw as Record<string, unknown>;
  return o;
}

function coerceQueueIdArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function mergeIdLists(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

/** Promote top-level `{ queueIds?, fatalErrorIds? }` variants and stringifiable error fields. */
export function coerceAckFailedFields(body: Record<string, unknown>): {
  queueIds: string[];
  fatalIds: string[];
  errorCode: string;
  errorMessage: string;
} {
  const queueIds = mergeIdLists(
    coerceQueueIdArray(body.queueIds),
    coerceQueueIdArray(body.queue_ids),
    coerceQueueIdArray(body.ids)
  );
  const fatalIds = mergeIdLists(
    coerceQueueIdArray(body.fatalErrorIds),
    coerceQueueIdArray(body.fatal_ids)
  );

  const codeRaw =
    body.errorCode ?? body.code ?? body.error_code ?? body.type ?? ('VALIDATION_FAILED' as unknown);
  const messageRaw =
    body.errorMessage ?? body.message ?? body.error ?? body.reason ?? body.details ?? codeRaw;

  return {
    queueIds,
    fatalIds,
    errorCode:
      typeof codeRaw === 'string'
        ? codeRaw.trim().slice(0, 64)
        : safeOciErrorString(codeRaw, 64),
    errorMessage:
      typeof messageRaw === 'string'
        ? messageRaw.trim().slice(0, 1024)
        : safeOciErrorString(messageRaw, 1024),
  };
}

/**
 * If body is a single granular result `{ id, status }` without `results` / `queueIds`, promote to `results: [item]`.
 */
export function promoteSingleGranularResult(body: Record<string, unknown>): Record<string, unknown> {
  const hasResults = Array.isArray(body.results);
  const hasQueueIds = Array.isArray(body.queueIds);
  if (hasResults || hasQueueIds) return body;
  if (typeof body.id === 'string' && (body.status === 'SUCCESS' || body.status === 'FAILED')) {
    return {
      ...body,
      results: [
        {
          id: body.id,
          status: body.status,
          ...(body.reason != null ? { reason: safeOciErrorString(body.reason, 256) } : {}),
        },
      ],
    };
  }
  return body;
}

export function isInfrastructurePostgrestError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const message = String((err as { message?: string }).message ?? '').toLowerCase();
  if (
    code === 'PGRST000' ||
    code === '57014' ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('timed out') ||
    message.includes('fetch failed')
  )
    return true;
  return false;
}

/** Prefer 503 retryable over opaque 500 for DB/upstream failures during ACK. */
export function dbUpstreamResponse(scope: string, err: unknown, fallbackCode = 'DB_UNAVAILABLE') {
  const msg = err instanceof Error ? err.message : safeOciErrorString(err);
  logError(scope, { error: msg, infrastructure: isInfrastructurePostgrestError(err) });
  return NextResponse.json({ error: 'Database unavailable', code: fallbackCode, retryable: true }, { status: 503 });
}

/**
 * Runs batch RPC then reconciles row states. Never throws.
 * Caller treats `stuckProcessingIds.length === 0` (and every id present or intentionally missing) as idempotent OK.
 */
export async function reconcileSignalDispatchOutcome(
  admin: SupabaseClient,
  params: {
    siteId: string;
    signalIds: string[];
    expectStatus: string;
    newStatus: string;
    googleSentAt?: string | null;
  }
): Promise<{
  rpcApplied: number;
  rowsSnapshot: Map<string, string>;
  stuckProcessingIds: string[];
  missingIds: string[];
}> {
  const { siteId, signalIds, expectStatus, newStatus, googleSentAt } = params;

  if (signalIds.length === 0) {
    return { rpcApplied: 0, rowsSnapshot: new Map(), stuckProcessingIds: [], missingIds: [] };
  }

  let rpcApplied = 0;
  try {
    rpcApplied = await applyMarketingSignalDispatchBatch(admin, {
      siteId,
      signalIds,
      expectStatus,
      newStatus,
      googleSentAt: googleSentAt ?? null,
    });
  } catch (e) {
    logError('OCI_SIGNAL_DISPATCH_RPC_THROW', {
      siteId,
      requested: signalIds.length,
      error: e instanceof Error ? e.message : safeOciErrorString(e),
    });
    rpcApplied = 0;
  }

  const { data: rows, error } = await admin
    .from('marketing_signals')
    .select('id, dispatch_status')
    .in('id', signalIds)
    .eq('site_id', siteId);

  if (error) {
    logError('OCI_SIGNAL_RECONCILE_SELECT_FAILED', { message: error.message });
    return {
      rpcApplied,
      rowsSnapshot: new Map(),
      stuckProcessingIds: signalIds,
      missingIds: [],
    };
  }

  const rowsSnapshot = new Map<string, string>(
    (Array.isArray(rows) ? rows : []).map((r: { id: string; dispatch_status: string }) => [r.id, r.dispatch_status])
  );

  const stuckProcessingIds: string[] = [];
  const missingIds: string[] = [];

  for (const id of signalIds) {
    const st = rowsSnapshot.get(id);
    if (st === undefined) {
      missingIds.push(id);
      continue;
    }
    if (st === expectStatus) {
      stuckProcessingIds.push(id);
    }
  }

  return { rpcApplied, rowsSnapshot, stuckProcessingIds, missingIds };
}
