import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logError, logInfo } from '@/lib/logging/logger';

const MAX_SAFE_ERROR_STRING = 2048;
/** Hard cap per DEFCON-1 — matches fleet script batch sizes + hostile payload ceiling. */
const OCI_ACK_MAX_ARRAY = 5000;
const OCI_ACK_ID_MAX_LEN = 512;
const OCI_ACK_SITE_ID_MAX = 128;
const OCI_ACK_RUN_ID_MAX = 128;
const OCI_ACK_REASON_MAX = 256;

export const ociAckGranularResultItemSchema = z
  .object({
    id: z.string().min(1).max(OCI_ACK_ID_MAX_LEN),
    status: z.enum(['SUCCESS', 'FAILED']),
    reason: z.string().max(OCI_ACK_REASON_MAX).optional().nullable(),
  })
  .strict();

export const ociAckTopLevelResultsArraySchema = z.array(ociAckGranularResultItemSchema).max(OCI_ACK_MAX_ARRAY);

/**
 * Strict allow-list for POST /api/oci/ack JSON object bodies (fleet scripts + API).
 * Unknown keys are rejected (.strict()) — no silent strip.
 */
export const ociAckStrictObjectBodySchema = z
  .object({
    siteId: z.string().trim().min(1).max(OCI_ACK_SITE_ID_MAX).optional(),
    queueIds: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    skippedIds: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    results: z.array(ociAckGranularResultItemSchema).max(OCI_ACK_MAX_ARRAY).optional(),
    pendingConfirmation: z.boolean().optional(),
    providerConfirmationMode: z.literal('bulk_upload_async_unconfirmed').optional(),
    export_run_id: z.string().max(OCI_ACK_RUN_ID_MAX).optional(),
    exportRunId: z.string().max(OCI_ACK_RUN_ID_MAX).optional(),
    id: z.string().min(1).max(OCI_ACK_ID_MAX_LEN).optional(),
    status: z.enum(['SUCCESS', 'FAILED']).optional(),
    reason: z.string().max(OCI_ACK_REASON_MAX).optional(),
  })
  .strict();

export type ParseAckJsonEnvelopeResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: 'invalid_top_level' }
  | { ok: false; reason: 'schema_violation'; issues: Array<{ path: string; message: string }> };

function formatZodIssues(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.length ? i.path.map(String).join('.') : '(root)',
    message: i.message,
  }));
}

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

/**
 * Google Ads Script `AdsApp.bulkUploads()` + `upload.apply()` is provider-async: ACK must not imply Google accepted the conversion.
 * `pendingConfirmation=true` or `providerConfirmationMode=bulk_upload_async_unconfirmed` → seal_* finalize as UPLOADED.
 */
export function resolveScriptAckPendingConfirmation(body: Record<string, unknown>): boolean {
  if (body.pendingConfirmation === true) return true;
  return body.providerConfirmationMode === 'bulk_upload_async_unconfirmed';
}

export function parseAckJsonEnvelope(rawBody: unknown): ParseAckJsonEnvelopeResult {
  if (Array.isArray(rawBody)) {
    const parsed = ociAckTopLevelResultsArraySchema.safeParse(rawBody);
    if (!parsed.success) {
      return { ok: false, reason: 'schema_violation', issues: formatZodIssues(parsed.error) };
    }
    const results = parsed.data.map((r) => ({
      ...r,
      reason: r.reason != null ? safeOciErrorString(r.reason, OCI_ACK_REASON_MAX) : r.reason,
    }));
    return { ok: true, body: { results } };
  }
  if (rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    const parsed = ociAckStrictObjectBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return { ok: false, reason: 'schema_violation', issues: formatZodIssues(parsed.error) };
    }
    const o = parsed.data;
    const body: Record<string, unknown> = {};
    if (o.siteId !== undefined) body.siteId = o.siteId;
    if (o.queueIds !== undefined) body.queueIds = o.queueIds;
    if (o.skippedIds !== undefined) body.skippedIds = o.skippedIds;
    if (o.results !== undefined) {
      body.results = o.results.map((r) => ({
        ...r,
        reason: r.reason != null ? safeOciErrorString(r.reason, OCI_ACK_REASON_MAX) : r.reason,
      }));
    }
    if (o.pendingConfirmation !== undefined) body.pendingConfirmation = o.pendingConfirmation;
    if (o.providerConfirmationMode !== undefined) body.providerConfirmationMode = o.providerConfirmationMode;
    if (o.export_run_id !== undefined) body.export_run_id = o.export_run_id;
    if (o.exportRunId !== undefined) body.exportRunId = o.exportRunId;
    if (o.id !== undefined) body.id = o.id;
    if (o.status !== undefined) body.status = o.status;
    if (o.reason !== undefined) body.reason = safeOciErrorString(o.reason, OCI_ACK_REASON_MAX);
    return { ok: true, body };
  }
  return { ok: false, reason: 'invalid_top_level' };
}

const ociAckFailedErrorCategorySchema = z.enum(['VALIDATION', 'TRANSIENT', 'AUTH', 'RATE_LIMIT', 'UNKNOWN']);

/**
 * Strict allow-list for POST /api/oci/ack-failed (matches fleet + coerceAckFailedFields legacy aliases).
 */
export const ociAckFailedStrictObjectBodySchema = z
  .object({
    siteId: z.string().trim().min(1).max(OCI_ACK_SITE_ID_MAX).optional(),
    queueIds: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    queue_ids: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    ids: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    fatalErrorIds: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    fatal_ids: z.array(z.string().min(1).max(OCI_ACK_ID_MAX_LEN)).max(OCI_ACK_MAX_ARRAY).optional(),
    errorCode: z.string().max(64).optional(),
    error_code: z.string().max(64).optional(),
    code: z.string().max(64).optional(),
    type: z.string().max(64).optional(),
    errorMessage: z.string().max(1024).optional(),
    message: z.string().max(1024).optional(),
    error: z.string().max(1024).optional(),
    reason: z.string().max(1024).optional(),
    details: z.string().max(1024).optional(),
    errorCategory: ociAckFailedErrorCategorySchema.optional(),
    export_run_id: z.string().max(OCI_ACK_RUN_ID_MAX).optional(),
    run_id: z.string().max(OCI_ACK_RUN_ID_MAX).optional(),
    exportRunId: z.string().max(OCI_ACK_RUN_ID_MAX).optional(),
  })
  .strict();

export type ParseAckFailedJsonEnvelopeResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: 'invalid_top_level' }
  | { ok: false; reason: 'schema_violation'; issues: Array<{ path: string; message: string }> };

/** Object-only JSON body for `/api/oci/ack-failed` (no array envelope). */
export function parseAckFailedJsonEnvelope(rawBody: unknown): ParseAckFailedJsonEnvelopeResult {
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, reason: 'invalid_top_level' };
  }
  const parsed = ociAckFailedStrictObjectBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, reason: 'schema_violation', issues: formatZodIssues(parsed.error) };
  }
  const o = parsed.data;
  const body: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined) body[k] = v;
  };
  put('siteId', o.siteId);
  put('queueIds', o.queueIds);
  put('queue_ids', o.queue_ids);
  put('ids', o.ids);
  put('fatalErrorIds', o.fatalErrorIds);
  put('fatal_ids', o.fatal_ids);
  put('errorCode', o.errorCode);
  put('error_code', o.error_code);
  put('code', o.code);
  put('type', o.type);
  put('errorMessage', o.errorMessage);
  put('message', o.message);
  put('error', o.error);
  put('reason', o.reason);
  put('details', o.details);
  put('errorCategory', o.errorCategory);
  put('export_run_id', o.export_run_id);
  put('run_id', o.run_id);
  put('exportRunId', o.exportRunId);
  return { ok: true, body };
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

export function verifyTransitionCount(params: {
  expectedCount: number;
  transitionedCount: number;
  alreadyTerminalCount: number;
  exportRunId?: string;
  route: 'ack' | 'ack_failed';
}): { ok: true } | { ok: false; payload: Record<string, unknown>; isReplay: boolean } {
  const matched = params.expectedCount === params.transitionedCount;
  const mismatchCount = Math.abs(params.expectedCount - params.transitionedCount);

  if (matched) {
    logInfo('DB_TRANSITION_MATCH', {
      expected_count: params.expectedCount,
      transitioned_count: params.transitionedCount,
      mismatch_count: mismatchCount,
      export_run_id: params.exportRunId,
      route: params.route,
      ids_count: params.expectedCount,
      status: 'PASS',
    });
    return { ok: true };
  }

  const isFullyAlreadyTerminal = params.alreadyTerminalCount > 0 && (params.transitionedCount + params.alreadyTerminalCount) === params.expectedCount;

  if (isFullyAlreadyTerminal) {
    const replayReason = params.route === 'ack' ? 'ACK_REPLAY_ALREADY_TERMINAL' : 'ACK_FAILED_REPLAY_ALREADY_TERMINAL';
    logInfo(replayReason, {
      expected_count: params.expectedCount,
      transitioned_count: params.transitionedCount,
      mismatch_count: mismatchCount,
      export_run_id: params.exportRunId,
      route: params.route,
      ids_count: params.expectedCount,
      status: 'PASS',
    });
    return {
      ok: false,
      isReplay: true,
      payload: {
        status: 'PARTIAL_FAIL',
        reason: replayReason,
        expected_count: params.expectedCount,
        transitioned_count: params.transitionedCount,
        mismatch_count: mismatchCount,
        matched: false,
        mismatch_reason: replayReason,
        export_run_id: params.exportRunId,
        route: params.route,
        ids_count: params.expectedCount,
      }
    };
  }

  logError('DB_TRANSITION_MISMATCH', {
    expected_count: params.expectedCount,
    transitioned_count: params.transitionedCount,
    mismatch_count: mismatchCount,
    export_run_id: params.exportRunId,
    route: params.route,
    ids_count: params.expectedCount,
    status: 'FAIL',
  });

  return {
    ok: false,
    isReplay: false,
    payload: {
      status: 'PARTIAL_FAIL',
      reason: 'DB_TRANSITION_MISMATCH',
      expected_count: params.expectedCount,
      transitioned_count: params.transitionedCount,
      mismatch_count: mismatchCount,
      matched: false,
      mismatch_reason: 'DB_TRANSITION_MISMATCH',
      export_run_id: params.exportRunId,
      route: params.route,
      ids_count: params.expectedCount,
    }
  };
}

