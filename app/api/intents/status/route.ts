/**
 * POST /api/intents/status — Probe V4 Intent (Android Edge-Node)
 *
 * Accepts quality score (1–5) for a phone number from Probe. Requires ECDSA signature
 * and device registration. Idempotent: 409 if idempotencyKey already processed.
 *
 * Headers: X-Ops-Site-Id (public_id or UUID), X-Ops-Device-Id
 * Body: idempotencyKey, phoneNumber, qualityScore, calibratedIntentValue, timestamp, signature
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { SiteService } from '@/lib/services/site-service';
import { appendFunnelEvent } from '@/lib/domain/funnel-kernel/ledger-writer';
import { verifyProbeSignature } from '@/lib/probe/verify-signature';
import { logWarn, logError } from '@/lib/logging/logger';
import { normalizeToE164 } from '@/lib/dic/e164';
import { resolveIntentConversation } from '@/lib/services/conversation-service';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/intents/status';

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const siteId = req.headers.get('x-ops-site-id')?.trim();
    const deviceId = req.headers.get('x-ops-device-id')?.trim();
    if (!siteId || !deviceId) {
      return NextResponse.json(
        { error: 'Missing X-Ops-Site-Id or X-Ops-Device-Id' },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
    const qualityScore = body.qualityScore != null ? Number(body.qualityScore) : null;
    const calibratedIntentValue = body.calibratedIntentValue != null ? Number(body.calibratedIntentValue) : null;
    const timestamp = body.timestamp != null ? Number(body.timestamp) : null;
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';

    if (!idempotencyKey || !phoneNumber || !signature) {
      return NextResponse.json(
        { error: 'Missing idempotencyKey, phoneNumber, or signature' },
        { status: 400 }
      );
    }
    if (qualityScore == null || qualityScore < 1 || qualityScore > 5) {
      return NextResponse.json(
        { error: 'qualityScore must be between 1 and 5' },
        { status: 400 }
      );
    }

    const { valid, site } = await SiteService.validateSite(siteId);
    if (!valid || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const siteUuid = site.id;

    const { data: device } = await adminClient
      .from('probe_devices')
      .select('id, public_key_pem')
      .eq('site_id', siteUuid)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!device?.public_key_pem) {
      return NextResponse.json(
        { error: 'Device not registered or unknown' },
        { status: 401 }
      );
    }

    const payloadWithoutSignature = {
      idempotencyKey,
      phoneNumber,
      qualityScore,
      calibratedIntentValue,
      timestamp,
    };
    const verifyResult = verifyProbeSignature(
      device.public_key_pem as string,
      payloadWithoutSignature,
      signature
    );
    if (!verifyResult.ok) {
      logWarn('PROBE_SIGNATURE_REJECTED', { route: ROUTE, site_id: siteUuid, device_id: deviceId, error: verifyResult.error });
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      );
    }

    const e164 = normalizeToE164(phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`, 'TR') || digitsOnly(phoneNumber);
    if (!e164 || e164.length < 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    const digits = digitsOnly(e164);

    let callId: string | null = null;

    const { data: calls } = await adminClient
      .from('calls')
      .select('id, intent_target, phone_number, caller_phone_e164')
      .eq('site_id', siteUuid)
      .order('created_at', { ascending: false })
      .limit(100);

    const match = calls?.find((c) => {
      const it = digitsOnly((c.intent_target as string) || '');
      const cp = digitsOnly((c.caller_phone_e164 as string) || '');
      const pn = digitsOnly((c.phone_number as string) || '');
      return it === digits || cp === digits || pn === digits;
    });

    if (match) {
      callId = match.id as string;
    } else {
      const { data: newCallId, error: rpcErr } = await adminClient.rpc('create_probe_call_v1', {
        p_site_id: siteUuid,
        p_intent_target: e164,
        p_idempotency_suffix: idempotencyKey.slice(-20),
      });
      if (rpcErr) {
        logError('PROBE_CREATE_CALL_FAILED', { route: ROUTE, site_id: siteUuid, error: rpcErr.message });
        return NextResponse.json(
          { error: 'Failed to create call record' },
          { status: 500 }
        );
      }
      callId = newCallId as string;
    }

    const occurredAt = timestamp != null && Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
    const { appended } = await appendFunnelEvent({
      callId,
      siteId: siteUuid,
      eventType: 'offered',
      eventSource: 'PROBE',
      idempotencyKey,
      occurredAt,
      payload: {
        quality_score: qualityScore,
        calibrated_intent_value: calibratedIntentValue,
        phone_number_e164: e164,
      },
    });

    if (!appended) {
      return NextResponse.json(
        { error: 'Duplicate idempotency key' },
        { status: 409 }
      );
    }

    await resolveIntentConversation({
      siteId: siteUuid,
      source: 'probe',
      intentAction: 'phone',
      intentTarget: e164,
      explicitPhoneE164: e164,
      primaryCallId: callId,
      mizanValue: calibratedIntentValue ?? qualityScore,
      idempotencyKey,
    });

    await adminClient
      .from('probe_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('site_id', siteUuid)
      .eq('device_id', deviceId);

    return NextResponse.json(
      { accepted: true, callId },
      { status: 202 }
    );
  } catch (e) {
    logError('PROBE_INTENT_STATUS_ERROR', { route: ROUTE, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
