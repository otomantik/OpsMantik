import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { createSessionToken } from '@/lib/oci/session-auth';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { getEntitlements } from '@/lib/entitlements/getEntitlements';
import { requireCapability, EntitlementError } from '@/lib/entitlements/requireEntitlement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const capGateEnv = (process.env.OCI_VERIFY_CAPABILITY_ENFORCE || '').trim().toLowerCase();
const ENFORCE_CAPABILITY_GATE =
  capGateEnv === '1' ||
  capGateEnv === 'true' ||
  (process.env.NODE_ENV === 'production' && capGateEnv !== '0' && capGateEnv !== 'false');

export async function POST(req: NextRequest) {
  try {
    const apiKey = (req.headers.get('x-api-key') || '').trim();
    const bodyUnknown = await req.json().catch(() => ({}));
    const body =
      bodyUnknown && typeof bodyUnknown === 'object' && !Array.isArray(bodyUnknown)
        ? (bodyUnknown as Record<string, unknown>)
        : {};
    const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : '';

    if (!siteId) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: 'siteId is required' }, { status: 400 });
    }

    // Identity boundary: public_id only on verify handshake.
    if (UUID_RE.test(siteId)) {
      return NextResponse.json(
        {
          code: 'IDENTITY_BOUNDARY',
          message: 'Handshake siteId must be site public_id; UUID is not allowed for this endpoint.',
        },
        { status: 400 }
      );
    }

    if (!apiKey) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-verify-authfail',
      });
      return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Missing API key' }, { status: 401 });
    }

    const { data: site, error } = await adminClient
      .from('sites')
      .select('id, public_id, oci_api_key')
      .eq('public_id', siteId)
      .maybeSingle();
    if (error || !site || !site.oci_api_key || !timingSafeCompare(site.oci_api_key, apiKey)) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-verify-authfail',
      });
      return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });
    }

    if (ENFORCE_CAPABILITY_GATE) {
      try {
        const entitlements = await getEntitlements(site.id, adminClient);
        requireCapability(entitlements, 'google_ads_sync');
      } catch (err) {
        if (err instanceof EntitlementError) {
          return NextResponse.json(
            { code: 'CAPABILITY_REQUIRED', message: 'google_ads_sync capability required' },
            { status: 403 }
          );
        }
        throw err;
      }
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const sessionToken = await createSessionToken(site.id, expiresAt);
    return NextResponse.json({
      session_token: sessionToken,
      expires_at: new Date(expiresAt * 1000).toISOString(),
      site_id: site.id,
      public_id: site.public_id,
    });
  } catch {
    return NextResponse.json({ code: 'SERVER_ERROR', message: 'Internal server error' }, { status: 500 });
  }
}
