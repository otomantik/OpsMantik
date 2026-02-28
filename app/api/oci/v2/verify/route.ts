/**
 * POST /api/oci/v2/verify — Iron Seal handshake for Google Ads Script.
 *
 * Identity Boundary: External systems must NEVER use internal UUIDs.
 * Body siteId = public_id only. Session token encodes internal UUID for export/ack.
 *
 * Body: { siteId: string } — MUST be public_id (reject UUID with 400)
 * Headers: x-api-key (must match sites.oci_api_key for the given site)
 * Response: { session_token, expires_at } — 5 min TTL; token encodes internal UUID.
 * Auth: OCI_SESSION_SECRET or CRON_SECRET for signing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { getIngestCorsHeaders } from '@/lib/security/cors';
import { createSessionToken } from '@/lib/oci/session-auth';
import { adminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SESSION_TTL_SEC = 300; // 5 min — Strict TTL

/** Reject internal UUIDs — external requests must use public_id */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Re-export for export/ack routes */
export { verifySessionToken } from '@/lib/oci/session-auth';

/** OPTIONS — CORS preflight for external script calls (Google Ads Script) */
export async function OPTIONS(_req: NextRequest) {
  const origin = _req.headers.get('origin');
  const headers = getIngestCorsHeaders(origin, {
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-api-key, X-OpsMantik-Version, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Signature',
  });
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsHeaders = getIngestCorsHeaders(origin);

  try {
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'MISSING_API_KEY', message: 'x-api-key header is required' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await req.json().catch(() => ({}));
    const siteIdRaw = typeof body.siteId === 'string' ? body.siteId.trim() : '';
    if (!siteIdRaw) {
      return NextResponse.json(
        { error: 'Bad Request', code: 'VALIDATION_FAILED', message: 'siteId is required in body' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (UUID_REGEX.test(siteIdRaw)) {
      return NextResponse.json(
        { error: 'Bad Request', code: 'IDENTITY_BOUNDARY', message: 'External requests must use public_id, not internal UUID' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Lookup by public_id only — Identity Boundary: no UUID from external payload
    const { data: siteRow, error: siteError } = await adminClient
      .from('sites')
      .select('id, oci_api_key')
      .eq('public_id', siteIdRaw)
      .not('oci_api_key', 'is', null)
      .maybeSingle();

    if (siteError) {
      logError('OCI_V2_VERIFY_DB_ERROR', { error: siteError.message });
      return NextResponse.json(
        { error: 'Internal Server Error', code: 'SERVER_ERROR', message: 'An unexpected error occurred' },
        { status: 500, headers: corsHeaders }
      );
    }

    if (!siteRow || !siteRow.oci_api_key || !timingSafeCompare(apiKey, siteRow.oci_api_key)) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-verify-authfail',
      });
      return NextResponse.json(
        { error: 'Unauthorized', code: 'INVALID_CREDENTIALS', message: 'Invalid or expired API key' },
        { status: 401, headers: corsHeaders }
      );
    }

    const siteUuid = siteRow.id;

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const sessionToken = createSessionToken(siteUuid, expiresAt);

    return NextResponse.json(
      {
        session_token: sessionToken,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (e: unknown) {
    logError('OCI_V2_VERIFY_ERROR', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'SERVER_ERROR', message: 'An unexpected error occurred' },
      { status: 500, headers: corsHeaders }
    );
  }
}
