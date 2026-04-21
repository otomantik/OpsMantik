import type { NextRequest } from 'next/server';
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
  signalCursorUpdatedAt: string | null;
  signalCursorId: string | null;
  wantsJwe: boolean;
  publicKeyB64: string | undefined;
};

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
  let signalCursorUpdatedAt: string | null = null;
  let signalCursorId: string | null = null;
  const cursorStr = searchParams.get('cursor');
  if (cursorStr) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
      const queueCursor = readExportCursorMark(decoded?.q ?? decoded);
      const signalCursor = readExportCursorMark(decoded?.s ?? decoded);
      queueCursorUpdatedAt = queueCursor?.t ?? null;
      queueCursorId = queueCursor?.i ?? null;
      signalCursorUpdatedAt = signalCursor?.t ?? null;
      signalCursorId = signalCursor?.i ?? null;
    } catch {
      // cursor invalid; fall back to first page
    }
  }

  let isGhostCursor = false;
  if (queueCursorUpdatedAt) {
    const { data: latestRow } = await adminClient
      .from('offline_conversion_queue')
      .select('updated_at')
      .eq('site_id', siteId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ourMax = (latestRow as { updated_at?: string } | null)?.updated_at;
    if (ourMax && queueCursorUpdatedAt > ourMax) {
      isGhostCursor = true;
      const { data: consensus } = await adminClient
        .from('offline_conversion_queue')
        .select('updated_at, id')
        .eq('site_id', siteId)
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

  const byId = await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('id', siteId).maybeSingle();
  const byPublicId = byId.data
    ? null
    : await adminClient.from('sites').select('id, public_id, currency, timezone, oci_sync_method, oci_api_key, oci_config').eq('public_id', siteId).maybeSingle();
  const site = (byId.data ?? byPublicId?.data ?? null) as ExportSiteRow | null;
  if (!site) throw new ExportHttpError(404, { error: 'Site not found' });

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

  return {
    site,
    siteUuid: site.id,
    markAsExported: searchParams.get('markAsExported') === 'true',
    providerFilter: searchParams.get('providerKey') ?? 'google_ads',
    isGhostCursor,
    exportConfig: parseExportConfig(site.oci_config),
    queueCursorUpdatedAt,
    queueCursorId,
    signalCursorUpdatedAt,
    signalCursorId,
    wantsJwe: req.headers.get('x-oci-jwe-accept') === 'true',
    publicKeyB64: process.env.VOID_PUBLIC_KEY,
  };
}
