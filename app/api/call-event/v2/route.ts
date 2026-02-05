import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';

import { adminClient } from '@/lib/supabase/admin';
import { RateLimitService } from '@/lib/services/RateLimitService';
import { parseAllowedOrigins, isOriginAllowed } from '@/lib/cors';
import { getRecentMonths } from '@/lib/sync-utils';
import { logError, logWarn } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/call-event/v2';
const OPSMANTIK_VERSION = '2.0.0-proxy';
const ALLOWED_ORIGINS = parseAllowedOrigins();

const MAX_BODY_BYTES = 64 * 1024;
const SITE_PUBLIC_ID_RE = /^[a-f0-9]{32}$/i;

// V2 payload is identical to V1 but adds event_id (for upcoming idempotency).
const CallEventV2Schema = z
  .object({
    event_id: z.string().uuid().optional(),
    site_id: z.string().min(1).max(64).regex(SITE_PUBLIC_ID_RE),
    fingerprint: z.string().min(1).max(128),
    phone_number: z.string().max(256).nullable().optional(),
    value: z.union([z.number(), z.string(), z.null()]).optional(),
    intent_action: z.string().max(32).nullable().optional(),
    intent_target: z.string().max(512).nullable().optional(),
    intent_stamp: z.string().max(128).nullable().optional(),
    intent_page_url: z.string().max(2048).nullable().optional(),
    click_id: z.string().max(256).nullable().optional(),
  })
  .strict();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizePhoneTarget(raw: string): string {
  const t = raw.trim();
  if (t.toLowerCase().startsWith('tel:')) return t.slice(4).replace(/[^\d+]/g, '');
  if (/^\+?\d[\d\s().-]{6,}$/.test(t)) return t.replace(/[^\d+]/g, '');
  return t;
}

function inferIntentAction(phoneOrHref: string): 'phone' | 'whatsapp' {
  const v = phoneOrHref.toLowerCase();
  if (v.includes('wa.me') || v.includes('whatsapp.com')) return 'whatsapp';
  if (v.startsWith('tel:')) return 'phone';
  return 'phone';
}

function rand4(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}
function hash6(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  const out = Math.abs(h).toString(36);
  return out.slice(0, 6).padEnd(6, '0');
}
function makeIntentStamp(actionShort: string, target: string): string {
  const ts = Date.now();
  const tHash = hash6((target || '').toLowerCase());
  return `${ts}-${rand4()}-${actionShort}-${tHash}`;
}

function parseValueAllowNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin');
  const { isAllowed, reason } = isOriginAllowed(origin, ALLOWED_ORIGINS);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ops-Site-Id, X-Ops-Ts, X-Ops-Signature, X-Ops-Proxy',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-OpsMantik-Version': OPSMANTIK_VERSION,
    'X-CORS-Status': isAllowed ? 'allowed' : 'rejected',
    'X-CORS-Reason': reason || 'ok',
  };
  if (isAllowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  return new NextResponse(null, { status: isAllowed ? 200 : 403, headers });
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? undefined;

  try {
    // CORS: V2 is intended for server-to-server proxy calls.
    // If Origin is present, enforce allowlist; if missing, allow (server-to-server).
    const origin = req.headers.get('origin');
    const cors = origin ? isOriginAllowed(origin, ALLOWED_ORIGINS) : { isAllowed: true, reason: 'no_origin' as const };

    const baseHeaders: Record<string, string> = {
      Vary: 'Origin',
      'X-OpsMantik-Version': OPSMANTIK_VERSION,
      'X-CORS-Status': cors.isAllowed ? 'allowed' : 'rejected',
      'X-CORS-Reason': cors.reason || 'ok',
    };
    if (cors.isAllowed && origin) baseHeaders['Access-Control-Allow-Origin'] = origin;
    if (!cors.isAllowed) return NextResponse.json({ error: 'Origin not allowed', reason: cors.reason }, { status: 403, headers: baseHeaders });

    // Read raw body for signature + size guard
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: baseHeaders });
    }

    // Signature headers (fail-closed)
    const headerSiteId = (req.headers.get('x-ops-site-id') || '').trim();
    const headerTs = (req.headers.get('x-ops-ts') || '').trim();
    const headerSig = (req.headers.get('x-ops-signature') || '').trim();

    if (!headerSiteId || !SITE_PUBLIC_ID_RE.test(headerSiteId) || !/^\d{9,12}$/.test(headerTs) || !/^[0-9a-f]{64}$/i.test(headerSig)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
    }

    const tsNum = Number(headerTs);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsNum) || nowSec - tsNum > 300 || tsNum - nowSec > 60) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
    }

    // Verify signature via DB (boolean only; no secrets to browser).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      logError('call-event-v2 verifier misconfigured (missing supabase env)', { request_id: requestId, route: ROUTE });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: baseHeaders });
    }
    const { createClient } = await import('@supabase/supabase-js');
    const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: sigOk, error: sigErr } = await anonClient.rpc('verify_call_event_signature_v1', {
      p_site_public_id: headerSiteId,
      p_ts: tsNum,
      p_raw_body: rawBody,
      p_signature: headerSig,
    });
    if (sigErr || sigOk !== true) {
      logWarn('call-event-v2 signature rejected', { request_id: requestId, route: ROUTE, site_id: headerSiteId, error: sigErr?.message });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });
    }

    // Rate limit (critical): include site to isolate blast-radius.
    const clientId = RateLimitService.getClientId(req);
    const rl = await RateLimitService.checkWithMode(`${headerSiteId}|${clientId}`, 80, 60 * 1000, {
      mode: 'degraded',
      namespace: 'call-event-v2',
      fallbackMaxRequests: 15,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        {
          status: 429,
          headers: {
            ...baseHeaders,
            'X-RateLimit-Limit': '80',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rl.resetAt.toString(),
            'Retry-After': Math.ceil((rl.resetAt - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    // JSON parse + strict validation
    let bodyJson: unknown;
    try {
      bodyJson = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      logWarn('call-event-v2 invalid json body', { request_id: requestId, route: ROUTE, error: String((e as Error)?.message ?? e) });
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: baseHeaders });
    }
    if (!isRecord(bodyJson)) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: baseHeaders });
    const parsed = CallEventV2Schema.safeParse(bodyJson);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: baseHeaders });

    const body = parsed.data;
    // Bind header/body site id
    if (body.site_id !== headerSiteId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: baseHeaders });

    const site_public_id = body.site_id;
    const fingerprint = body.fingerprint;
    const phone_number = typeof body.phone_number === 'string' ? body.phone_number : null;
    const value = parseValueAllowNull(body.value);

    // Now it's safe to use service-role DB calls.
    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .select('id')
      .eq('public_id', site_public_id)
      .single();

    if (siteError || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404, headers: baseHeaders });
    }

    // Find recent session by fingerprint
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentMonths = getRecentMonths(2);
    const { data: recentEvents, error: eventsError } = await adminClient
      .from('events')
      .select('session_id, session_month, metadata, created_at')
      .eq('metadata->>fingerprint', fingerprint)
      .in('session_month', recentMonths)
      .gte('created_at', thirtyMinutesAgo)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    if (eventsError) {
      logError('call-event-v2 events query error', { request_id: requestId, route: ROUTE, site_id: site_public_id, message: eventsError.message, code: eventsError.code });
      return NextResponse.json({ error: 'Failed to query events' }, { status: 500, headers: baseHeaders });
    }

    let matchedSessionId: string | null = null;
    let leadScore = 0;
    let scoreBreakdown: any = null;
    let callStatus: string | null = null;
    const matchedAt = new Date().toISOString();

    if (recentEvents && recentEvents.length > 0) {
      matchedSessionId = recentEvents[0].session_id;
      const sessionMonth = recentEvents[0].session_month;

      const { data: session, error: sessionError } = await adminClient
        .from('sessions')
        .select('id, created_at, created_month')
        .eq('id', matchedSessionId)
        .eq('created_month', sessionMonth)
        .single();

      if (sessionError || !session) {
        matchedSessionId = null;
      } else {
        const sessionCreatedAt = new Date(session.created_at);
        const matchTime = new Date(matchedAt);
        const timeDiffMinutes = (sessionCreatedAt.getTime() - matchTime.getTime()) / (1000 * 60);
        callStatus = timeDiffMinutes > 2 ? 'suspicious' : 'intent';

        const { data: sessionEvents, error: sessionEventsError } = await adminClient
          .from('events')
          .select('event_category, event_action, metadata')
          .eq('session_id', matchedSessionId)
          .eq('session_month', sessionMonth);

        if (sessionEventsError) {
          logError('call-event-v2 session events query error', { request_id: requestId, route: ROUTE, site_id: site_public_id, session_id: matchedSessionId, message: sessionEventsError.message, code: sessionEventsError.code });
          return NextResponse.json({ error: 'Failed to query session events' }, { status: 500, headers: baseHeaders });
        }

        if (sessionEvents && sessionEvents.length > 0) {
          const conversionCount = sessionEvents.filter(e => e.event_category === 'conversion').length;
          const interactionCount = sessionEvents.filter(e => e.event_category === 'interaction').length;
          const scores = sessionEvents.map(e => Number((e.metadata as any)?.lead_score) || 0);
          const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
          const conversionPoints = conversionCount * 20;
          const interactionPoints = interactionCount * 5;
          const bonuses = maxScore;
          const rawScore = conversionPoints + interactionPoints + bonuses;
          const cappedAt100 = rawScore > 100;
          leadScore = Math.min(rawScore, 100);
          scoreBreakdown = { conversionPoints, interactionPoints, bonuses, cappedAt100, rawScore, finalScore: leadScore };
        }
      }
    }

    const inferredAction = inferIntentAction(phone_number ?? '');
    const intent_action =
      typeof body.intent_action === 'string' && body.intent_action.trim() !== ''
        ? (body.intent_action.trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'phone')
        : inferredAction;
    const intent_target =
      typeof body.intent_target === 'string' && body.intent_target.trim() !== ''
        ? body.intent_target.trim()
        : normalizePhoneTarget(phone_number ?? 'Unknown');
    const intent_stamp =
      typeof body.intent_stamp === 'string' && body.intent_stamp.trim() !== ''
        ? body.intent_stamp.trim()
        : makeIntentStamp(intent_action === 'whatsapp' ? 'wa' : 'tel', intent_target);
    const intent_page_url =
      typeof body.intent_page_url === 'string' && body.intent_page_url.trim() !== '' ? body.intent_page_url.trim() : (req.headers.get('referer') || null);
    const click_id = typeof body.click_id === 'string' && body.click_id.trim() !== '' ? body.click_id.trim() : null;

    const { data: callRecord, error: insertError } = await adminClient
      .from('calls')
      .insert({
        site_id: site.id,
        phone_number,
        matched_session_id: matchedSessionId,
        matched_fingerprint: fingerprint,
        lead_score: leadScore,
        lead_score_at_match: matchedSessionId ? leadScore : null,
        score_breakdown: scoreBreakdown,
        matched_at: matchedSessionId ? matchedAt : null,
        status: callStatus,
        source: 'click',
        intent_action,
        intent_target,
        intent_stamp,
        intent_page_url,
        click_id,
        ...(value !== null ? { _client_value: value } : {}),
        ...(body.event_id ? { event_id: body.event_id } : {}),
      })
      .select()
      .single();

    if (insertError) {
      logError('call-event-v2 insert failed', { request_id: requestId, route: ROUTE, site_id: site_public_id, message: insertError.message, code: insertError.code });
      return NextResponse.json({ error: 'Failed to record call' }, { status: 500, headers: baseHeaders });
    }

    return NextResponse.json(
      { status: 'matched', call_id: callRecord.id, session_id: matchedSessionId, lead_score: leadScore },
      {
        headers: {
          ...baseHeaders,
          'X-RateLimit-Limit': '80',
          'X-RateLimit-Remaining': rl.remaining.toString(),
          'X-Ops-Proxy': (req.headers.get('x-ops-proxy') || '').toString().slice(0, 8),
        },
      }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('call-event-v2 unhandled error', { request_id: requestId, route: ROUTE, message: msg });
    Sentry.captureException(e, { tags: { route: ROUTE, request_id: requestId } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: { Vary: 'Origin' } });
  }
}

