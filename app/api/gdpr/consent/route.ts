/**
 * POST /api/gdpr/consent — KVKK/GDPR rıza kaydı (CMP callback vb.)
 * Auth: HMAC via verify_gdpr_consent_signature_v1 (isolated, NOT call-event verifier)
 * Source of truth: sessions.consent_at, sessions.consent_scopes (NOT gdpr_consents)
 * Rate limit: 10/hour per identifier, 60/hour per IP
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@supabase/supabase-js';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { SITE_PUBLIC_ID_RE, SITE_UUID_RE } from '@/lib/security/site-identifier';
import { verifyGdprConsentSignatureV1 } from '@/lib/security/verify-gdpr-consent-signature-v1';
import { ReplayCacheService } from '@/lib/services/replay-cache-service';

const IDENTIFIER_TYPES = ['fingerprint', 'session_id'] as const;
const VALID_SCOPES = ['analytics', 'marketing'];
const RL_IDENTIFIER_LIMIT = 10;
const RL_IDENTIFIER_WINDOW = 60 * 60 * 1000; // 1h
const RL_IP_LIMIT = 60;
const RL_IP_WINDOW = 60 * 60 * 1000; // 1h

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Nonce, X-Ops-Signature',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const clientId = RateLimitService.getClientId(req);

  // Rate limit: 60/hour per IP
  const ipKey = `gdpr_consent_ip:${clientId}`;
  const rlIp = await RateLimitService.checkWithMode(ipKey, RL_IP_LIMIT, RL_IP_WINDOW, {
    mode: 'fail-closed',
    namespace: 'gdpr',
  });
  if (!rlIp.allowed) {
    const retryAfter = Math.ceil((rlIp.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

  const signingDisabled = process.env.CALL_EVENT_SIGNING_DISABLED === '1' || process.env.CALL_EVENT_SIGNING_DISABLED === 'true';
  let headerSiteId = '';

  if (!signingDisabled) {
    headerSiteId = (req.headers.get('x-ops-site-id') || '').trim();
    const headerTs = (req.headers.get('x-ops-ts') || '').trim();
    const headerNonce = (req.headers.get('x-ops-nonce') || '').trim();
    const headerSig = (req.headers.get('x-ops-signature') || '').trim();

    if (
      !headerSiteId ||
      !(SITE_PUBLIC_ID_RE.test(headerSiteId) || SITE_UUID_RE.test(headerSiteId)) ||
      !/^\d{9,12}$/.test(headerTs) ||
      !headerNonce ||
      headerNonce.length > 128 ||
      !/^[0-9a-f]{64}$/i.test(headerSig)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Nonce replay protection (Redis 5 min TTL). Same nonce twice → reject.
    const nonceKey = `${headerSiteId}:${headerTs}:${headerNonce}`;
    const { isReplay } = await ReplayCacheService.checkAndStore(nonceKey, 5 * 60 * 1000, {
      mode: 'fail-closed',
      namespace: 'gdpr-consent',
    });
    if (isReplay) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let bodyForSig: Record<string, unknown>;
    try {
      bodyForSig = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const identifierType = typeof bodyForSig.identifier_type === 'string' ? bodyForSig.identifier_type.trim().toLowerCase() : '';
    const identifierValue = typeof bodyForSig.identifier_value === 'string' ? bodyForSig.identifier_value.trim().slice(0, 256) : '';
    const scopesRaw = bodyForSig.scopes;
    const consentScopesForSig = Array.isArray(scopesRaw)
      ? scopesRaw.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter((s) => VALID_SCOPES.includes(s))
      : [];
    const consentAt = typeof bodyForSig.consent_at === 'string' ? bodyForSig.consent_at : new Date().toISOString();

    const ok = await verifyGdprConsentSignatureV1(url, anonKey, {
      siteId: headerSiteId,
      ts: Number(headerTs),
      nonce: headerNonce,
      identifierType,
      identifierValue,
      consentScopesJson: JSON.stringify(consentScopesForSig),
      consentAt,
      signature: headerSig,
    });
    if (!ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    let parsed: unknown;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const rec = parsed as Record<string, unknown>;
    headerSiteId = typeof rec.site_id === 'string' ? rec.site_id.trim() : '';
    if (!headerSiteId) {
      return NextResponse.json({ error: 'site_id required when signing disabled' }, { status: 400 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const identifier_type = typeof body.identifier_type === 'string' ? body.identifier_type.trim().toLowerCase() : '';
  const identifier_value = typeof body.identifier_value === 'string' ? body.identifier_value.trim().slice(0, 256) : '';
  const scopesRaw = body.scopes;
  let consent_scopes: string[] = [];
  if (Array.isArray(scopesRaw)) {
    consent_scopes = scopesRaw
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => VALID_SCOPES.includes(s));
  }

  if (!identifier_type || !identifier_value) {
    return NextResponse.json(
      { error: 'identifier_type and identifier_value are required' },
      { status: 400 }
    );
  }
  if (!IDENTIFIER_TYPES.includes(identifier_type as (typeof IDENTIFIER_TYPES)[number])) {
    return NextResponse.json(
      { error: `identifier_type must be one of: ${IDENTIFIER_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  // Rate limit: 10/hour per identifier
  const idKey = `gdpr_consent_id:${headerSiteId}:${identifier_type}:${identifier_value}`;
  const rlId = await RateLimitService.checkWithMode(idKey, RL_IDENTIFIER_LIMIT, RL_IDENTIFIER_WINDOW, {
    mode: 'fail-closed',
    namespace: 'gdpr',
  });
  if (!rlId.allowed) {
    const retryAfter = Math.ceil((rlId.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded for identifier', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  let siteUuidFinal: string;
  const { data: resolved } = await anonClient.rpc('resolve_site_identifier_v1', { p_input: headerSiteId });
  if (typeof resolved === 'string') {
    siteUuidFinal = resolved;
  } else {
    const { data: byId } = await adminClient.from('sites').select('id').eq('id', headerSiteId).maybeSingle();
    if (byId?.id) {
      siteUuidFinal = byId.id;
    } else {
      const { data: byPub } = await adminClient.from('sites').select('id').eq('public_id', headerSiteId).maybeSingle();
      if (!byPub?.id) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
      siteUuidFinal = byPub.id;
    }
  }

  // Source of truth: sessions.consent_at, sessions.consent_scopes (NOT gdpr_consents)
  const consentAtIso = new Date().toISOString();
  if (identifier_type === 'session_id') {
    const { error: updErr } = await adminClient
      .from('sessions')
      .update({ consent_at: consentAtIso, consent_scopes: consent_scopes })
      .eq('site_id', siteUuidFinal)
      .eq('id', identifier_value);
    if (updErr) {
      return NextResponse.json({ error: 'Failed to update sessions' }, { status: 500 });
    }
  } else {
    const { error: updErr } = await adminClient
      .from('sessions')
      .update({ consent_at: consentAtIso, consent_scopes: consent_scopes })
      .eq('site_id', siteUuidFinal)
      .eq('fingerprint', identifier_value);
    if (updErr) {
      return NextResponse.json({ error: 'Failed to update sessions' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, scopes: consent_scopes });
}
