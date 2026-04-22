import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';

type ResolvedSite = { id: string; public_id?: string | null; oci_api_key?: string | null };

async function resolveSite(siteId: string): Promise<ResolvedSite | null> {
  const byId = await adminClient.from('sites').select('id, public_id, oci_api_key').eq('id', siteId).maybeSingle();
  const byIdRow = byId.data as ResolvedSite | null;
  if (byIdRow) return byIdRow;
  const byPublic = await adminClient
    .from('sites')
    .select('id, public_id, oci_api_key')
    .eq('public_id', siteId)
    .maybeSingle();
  return (byPublic.data as ResolvedSite | null) ?? null;
}

export async function resolveOciScriptAuth(params: {
  req: NextRequest;
  siteIdFromBody: unknown;
  authFailNamespace: string;
}): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; siteUuid: string; resolvedSite: ResolvedSite; siteIdFromToken: string | null }
> {
  const bearer = (params.req.headers.get('authorization') || '').trim();
  const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  const apiKey = (params.req.headers.get('x-api-key') || '').trim();

  let siteIdFromToken = '';
  if (sessionToken) {
    const parsed = await verifySessionToken(sessionToken);
    if (parsed) siteIdFromToken = parsed.siteId;
  }

  const hasAuthAttempt = !!siteIdFromToken || !!apiKey;
  if (!hasAuthAttempt) {
    const clientId = RateLimitService.getClientId(params.req);
    await RateLimitService.checkWithMode(clientId, 30, 60 * 1000, {
      mode: 'fail-closed',
      namespace: params.authFailNamespace,
    });
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const siteIdBody = typeof params.siteIdFromBody === 'string' ? params.siteIdFromBody.trim() : '';
  const siteId = siteIdFromToken || siteIdBody;
  if (!siteId) {
    return { ok: false, response: NextResponse.json({ error: 'Missing siteId' }, { status: 400 }) };
  }

  const resolvedSite = await resolveSite(siteId);
  const siteUuid = resolvedSite?.id ?? siteId;

  if (apiKey) {
    if (!resolvedSite) {
      return { ok: false, response: NextResponse.json({ error: 'Unauthorized: Site not found' }, { status: 401 }) };
    }
    const siteKey = resolvedSite.oci_api_key ?? '';
    if (!siteKey || !timingSafeCompare(siteKey, apiKey)) {
      return { ok: false, response: NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 }) };
    }
  } else if (siteIdFromToken) {
    if (siteIdFromToken !== resolvedSite?.id) {
      return { ok: false, response: NextResponse.json({ error: 'Forbidden: Token site mismatch' }, { status: 403 }) };
    }
  } else {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!resolvedSite) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized: Site not found' }, { status: 401 }) };
  }
  return { ok: true, siteUuid, resolvedSite, siteIdFromToken: siteIdFromToken || null };
}
