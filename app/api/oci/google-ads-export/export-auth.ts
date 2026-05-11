import type { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';
import { parseExportConfig } from '@/lib/oci/site-export-config';
import { readExportCursorMark } from '@/lib/oci/google-ads-export/sanitize';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import type { ExportSiteRow } from '@/lib/oci/google-ads-export/types';

export class ExportHttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export type ExportAuthContext = {
  site: ExportSiteRow;
  siteUuid: string;
  markAsExported: boolean;
  providerFilter: string;
  isGhostCursor: boolean;
  exportConfig: ReturnType<typeof parseExportConfig>;
  queueCursorUpdatedAt: string | null;
  queueCursorId: string | null;
  wantsJwe: boolean;
  publicKeyB64: string | undefined;
  pageLimit: number;
  exportRunId: string;
  canaryMode: boolean;
  canaryExpectedQueueId: string | null;
  canaryAllowlistIds: string[];
  /** PR-9H.4F.1: whether raw request carried allowlist in query / header (preview diagnostics only). */
  canaryAllowlistQuerySeen: boolean;
  canaryAllowlistHeaderSeen: boolean;
};

function readCanaryHeader(req: NextRequest, name: string): string {
  return (req.headers.get(name) || '').trim();
}

function parseBooleanFlag(value: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseAllowlistIds(value: string): string[] {
  if (!value.trim()) return [];
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const id = part.trim();
    if (!id) continue;
    seen.add(id);
  }
  return [...seen];
}

export async function authorizeExportRequest(req: NextRequest): Promise<ExportAuthContext> {
  const bearer = (req.headers.get('authorization') || '').trim();
  const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  const apiKey = (req.headers.get('x-api-key') || '').trim();
  let siteIdFromAuth = '';
  if (sessionToken) {
    const parsed = await verifySessionToken(sessionToken);
    if (parsed) siteIdFromAuth = parsed.siteId;
  }
  if (!siteIdFromAuth && !apiKey) {
    const clientId = RateLimitService.getClientId(req);
    await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, { mode: 'fail-closed', namespace: 'oci-authfail' });
    throw new ExportHttpError(401, { error: 'Unauthorized' });
  }

  const { searchParams } = new URL(req.url);
  const siteIdParam = String(searchParams.get('siteId') || '');
  const siteId = siteIdFromAuth || siteIdParam;
  if (!siteId) throw new ExportHttpError(400, { error: 'Missing siteId' });
  if (process.env.OCI_EXPORT_PAUSED === 'true' || process.env.OCI_EXPORT_PAUSED === '1') {
    throw new ExportHttpError(503, { error: 'Export paused', code: 'EXPORT_PAUSED' });
  }

  let queueCursorUpdatedAt: string | null = null;
  let queueCursorId: string | null = null;
  const cursorStr = searchParams.get('cursor');
  const requestedLimit = Number(searchParams.get('limit') ?? 250);
  const pageLimit = Math.min(1000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 250));
  const markAsExported = searchParams.get('markAsExported') === 'true';
  const canaryMode =
    parseBooleanFlag(searchParams.get('canaryMode')) ||
    parseBooleanFlag(readCanaryHeader(req, 'x-opsmantik-canary-mode'));
  const canaryExpectedQueueIdHeader = readCanaryHeader(req, 'x-opsmantik-canary-expected-queue-id');
  const canaryExpectedQueueIdQuery = String(searchParams.get('canaryExpectedQueueId') || '').trim();
  const canaryExpectedQueueId = canaryExpectedQueueIdHeader || canaryExpectedQueueIdQuery || null;
  const canaryAllowlistRawHeader = readCanaryHeader(req, 'x-opsmantik-allowlist-ids');
  const canaryAllowlistRawQuery = String(searchParams.get('allowlistIds') || '').trim();
  /** Alternate query keys — some proxies normalize/drop camelCase; Apps Script may emit snake_case. */
  const canaryAllowlistRawQuerySnake = String(searchParams.get('allowlist_ids') || '').trim();
  const canaryAllowlistQuerySeen =
    canaryAllowlistRawQuery.length > 0 || canaryAllowlistRawQuerySnake.length > 0;
  const canaryAllowlistHeaderSeen = canaryAllowlistRawHeader.length > 0;
  const canaryAllowlistIds = parseAllowlistIds(
    [canaryAllowlistRawHeader, canaryAllowlistRawQuery, canaryAllowlistRawQuerySnake].filter(Boolean).join(',')
  );
  if (cursorStr) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
      const queueCursor = readExportCursorMark(decoded?.q ?? decoded);
      queueCursorUpdatedAt = queueCursor?.t ?? null;
      queueCursorId = queueCursor?.i ?? null;
    } catch {
      // cursor invalid; fall back to first page
    }
  }

  let isGhostCursor = false;

  const byId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('id', siteId).maybeSingle();
  const byPublicId = byId.data
    ? null
    : await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('public_id', siteId).maybeSingle();
  const site = (byId.data ?? byPublicId?.data ?? null) as ExportSiteRow | null;
  if (!site) throw new ExportHttpError(404, { error: 'Site not found' });

  // Run ghost-cursor detection only after resolving canonical site UUID.
  if (queueCursorUpdatedAt) {
    const { data: latestRow } = await adminClient
      .from('offline_conversion_queue')
      .select('updated_at')
      .eq('site_id', site.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ourMax = (latestRow as { updated_at?: string } | null)?.updated_at;
    if (ourMax && queueCursorUpdatedAt > ourMax) {
      isGhostCursor = true;
      const { data: consensus } = await adminClient
        .from('offline_conversion_queue')
        .select('updated_at, id')
        .eq('site_id', site.id)
        .eq('status', 'COMPLETED')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (consensus) {
        queueCursorUpdatedAt = (consensus as { updated_at: string }).updated_at;
        queueCursorId = (consensus as { id: string }).id;
      }
    }
  }

  if (apiKey) {
    if (!site.oci_api_key || !timingSafeCompare(site.oci_api_key, apiKey)) {
      throw new ExportHttpError(401, { error: 'Unauthorized: Invalid API key' });
    }
  } else if (siteIdFromAuth) {
    if (siteIdFromAuth !== site.id && siteIdFromAuth !== site.public_id) {
      throw new ExportHttpError(403, { error: 'Forbidden: Token site mismatch' });
    }
  } else {
    throw new ExportHttpError(401, { error: 'Unauthorized' });
  }

  if (site.oci_sync_method === 'api') {
    throw new ExportHttpError(400, {
      error: 'Site partition mismatch',
      details: 'This site is configured for backend API sync, not script export.',
    });
  }

  const entitlements = await getEntitlements(site.id, adminClient);
  try {
    requireCapability(entitlements, 'google_ads_sync');
  } catch (err) {
    if (err instanceof EntitlementError) {
      throw new ExportHttpError(403, { error: 'Forbidden', code: 'CAPABILITY_REQUIRED', capability: err.capability });
    }
    throw err;
  }

  const exportRl = await RateLimitService.checkWithMode(
    `site:${site.id}`,
    120,
    60_000,
    { mode: 'fail-open', namespace: 'oci-google-ads-export' }
  );
  if (!exportRl.allowed) {
    throw new ExportHttpError(429, { error: 'Too many requests', code: 'RATE_LIMITED' });
  }

  const exportRunId = `oci_run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  if (canaryMode && markAsExported) {
    const changeTicket = readCanaryHeader(req, 'x-opsmantik-change-ticket');
    const operatorId = readCanaryHeader(req, 'x-opsmantik-operator-id');
    const canaryApproval = readCanaryHeader(req, 'x-opsmantik-canary-approval');
    const canarySiteId = readCanaryHeader(req, 'x-opsmantik-canary-site-id');
    const canaryMaxBatchSize = readCanaryHeader(req, 'x-opsmantik-canary-max-batch-size');
    const missing: string[] = [];
    if (!changeTicket) missing.push('x-opsmantik-change-ticket');
    if (!operatorId) missing.push('x-opsmantik-operator-id');
    if (!canaryApproval) missing.push('x-opsmantik-canary-approval');
    if (!canarySiteId) missing.push('x-opsmantik-canary-site-id');
    if (!canaryMaxBatchSize) missing.push('x-opsmantik-canary-max-batch-size');
    if (!canaryExpectedQueueId) missing.push('x-opsmantik-canary-expected-queue-id');
    if (canaryAllowlistIds.length === 0) missing.push('x-opsmantik-allowlist-ids');
    if (missing.length > 0) {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: missing required canary metadata',
        code: 'CANARY_EXPORT_BLOCKED',
        missing,
      });
    }
    if (canaryApproval !== 'I_APPROVE_PRODUCTION_CANARY') {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: invalid canary approval token',
        code: 'CANARY_EXPORT_BLOCKED',
      });
    }
    if (canarySiteId !== site.id && canarySiteId !== site.public_id) {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: canary site mismatch',
        code: 'CANARY_EXPORT_BLOCKED',
      });
    }
    if (canaryMaxBatchSize !== '1' || pageLimit !== 1) {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: canary max batch size must be 1',
        code: 'CANARY_EXPORT_BLOCKED',
      });
    }
    if (canaryAllowlistIds.length !== 1) {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: allowlist must contain exactly one queue id',
        code: 'CANARY_EXPORT_BLOCKED',
      });
    }
    if (canaryAllowlistIds[0] !== canaryExpectedQueueId) {
      throw new ExportHttpError(409, {
        error: 'Canary export blocked: allowlist id must equal expected queue id',
        code: 'CANARY_EXPORT_BLOCKED',
      });
    }
  }

  /**
   * PR-9I — Broad mutating export without canary allowlist requires explicit operator approval.
   * Canary path (allowlist + canaryMode + headers) stays separate.
   */
  const broadMutatingExport = markAsExported && !canaryMode && canaryAllowlistIds.length === 0;
  if (broadMutatingExport) {
    const drainApproval =
      readCanaryHeader(req, 'x-opsmantik-drain-approval') ||
      String(process.env.OPSMANTIK_DRAIN_APPROVAL ?? '').trim();
    const drainSiteId =
      readCanaryHeader(req, 'x-opsmantik-drain-site-id') ||
      String(process.env.OPSMANTIK_DRAIN_SITE_ID ?? '').trim();
    const drainMaxBatchRaw =
      readCanaryHeader(req, 'x-opsmantik-drain-max-batch-size') ||
      String(process.env.OPSMANTIK_DRAIN_MAX_BATCH_SIZE ?? '').trim();
    const drainIncludeBraids =
      readCanaryHeader(req, 'x-opsmantik-drain-include-braids') ||
      String(process.env.OPSMANTIK_DRAIN_INCLUDE_BRAIDS ?? '').trim();

    const missingDrain: string[] = [];
    if (!drainApproval) missingDrain.push('x-opsmantik-drain-approval / OPSMANTIK_DRAIN_APPROVAL');
    if (!drainSiteId) missingDrain.push('x-opsmantik-drain-site-id / OPSMANTIK_DRAIN_SITE_ID');
    if (!drainMaxBatchRaw) missingDrain.push('x-opsmantik-drain-max-batch-size / OPSMANTIK_DRAIN_MAX_BATCH_SIZE');
    if (!drainIncludeBraids) missingDrain.push('x-opsmantik-drain-include-braids / OPSMANTIK_DRAIN_INCLUDE_BRAIDS');

    if (missingDrain.length > 0) {
      throw new ExportHttpError(409, {
        error: 'Script drain blocked: missing broad drain approval metadata',
        code: 'SCRIPT_DRAIN_BLOCKED',
        missing: missingDrain,
      });
    }

    if (drainApproval !== 'I_APPROVE_SCRIPT_DRAIN') {
      throw new ExportHttpError(409, {
        error: 'Script drain blocked: invalid drain approval token',
        code: 'SCRIPT_DRAIN_BLOCKED',
      });
    }

    if (drainSiteId !== site.id && drainSiteId !== site.public_id) {
      throw new ExportHttpError(409, {
        error: 'Script drain blocked: drain site mismatch',
        code: 'SCRIPT_DRAIN_BLOCKED',
      });
    }

    const drainMaxBatch = Number(drainMaxBatchRaw);
    if (!Number.isFinite(drainMaxBatch) || drainMaxBatch < pageLimit) {
      throw new ExportHttpError(409, {
        error: 'Script drain blocked: drain max batch size must be >= requested limit',
        code: 'SCRIPT_DRAIN_BLOCKED',
      });
    }

    const braidsOk = drainIncludeBraids === 'true' || drainIncludeBraids === '1';
    if (!braidsOk) {
      throw new ExportHttpError(409, {
        error: 'Script drain blocked: braids must be explicitly acknowledged (true)',
        code: 'SCRIPT_DRAIN_BLOCKED',
      });
    }
  }

  return {
    site,
    siteUuid: site.id,
    markAsExported,
    providerFilter: searchParams.get('providerKey') ?? 'google_ads',
    isGhostCursor,
    exportConfig: parseExportConfig(site.oci_config),
    queueCursorUpdatedAt,
    queueCursorId,
    wantsJwe: req.headers.get('x-oci-jwe-accept') === 'true',
    publicKeyB64: process.env.VOID_PUBLIC_KEY,
    pageLimit,
    exportRunId,
    canaryMode,
    canaryExpectedQueueId,
    canaryAllowlistIds,
    canaryAllowlistQuerySeen,
    canaryAllowlistHeaderSeen,
  };
}
