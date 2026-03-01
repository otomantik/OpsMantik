/**
 * MizanMantik — Domain Orchestrator
 *
 * Gatekeeper and Ledger Router. Not a calculator — routes signals.
 * V1: Redis (value=0). V2-V4: marketing_signals (decay). V5: Iron Seal (no decay).
 */

import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { calculateSignalEV } from './time-decay';
import type { OpsGear, SignalPayload, EvaluateResult } from './types';
import { LEGACY_TO_OPS_GEAR, type LegacySignalType } from './types';
import { OPSMANTIK_CONVERSION_NAMES } from './conversion-names';

const PV_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const V2_DEDUP_HOURS = 24;

function generatePvId(): string {
  return 'pv_' + crypto.randomUUID().replace(/-/g, '');
}

/** Legacy signal_type for marketing_signals (backward compat) */
function gearToLegacySignalType(gear: OpsGear): LegacySignalType | string {
  switch (gear) {
    case 'V2_PULSE': return 'INTENT_CAPTURED';
    case 'V3_ENGAGE': return 'MEETING_BOOKED';
    case 'V4_INTENT': return 'SEAL_PENDING';
    default: return 'OpsMantik_Signal';
  }
}

/** V2 dedup: call_id OR (site_id, gclid) within last 24h */
async function hasRecentV2Pulse(siteId: string, callId?: string | null, gclid?: string | null): Promise<boolean> {
  if (!callId && !gclid) return false;

  const cutoff = new Date(Date.now() - V2_DEDUP_HOURS * 60 * 60 * 1000).toISOString();

  if (callId) {
    const { data } = await adminClient
      .from('marketing_signals')
      .select('id')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('signal_type', 'INTENT_CAPTURED')
      .gte('created_at', cutoff)
      .limit(1);
    if (data && data.length > 0) return true;
  }

  if (gclid) {
    const { data: sessions } = await adminClient
      .from('sessions')
      .select('id')
      .eq('site_id', siteId)
      .eq('gclid', gclid)
      .limit(50);
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id);
      const { data: calls } = await adminClient
        .from('calls')
        .select('id')
        .eq('site_id', siteId)
        .in('matched_session_id', sessionIds)
        .limit(50);
      if (calls && calls.length > 0) {
        const callIds = calls.map((c: { id: string }) => c.id);
        const { data: signals } = await adminClient
          .from('marketing_signals')
          .select('id')
          .eq('site_id', siteId)
          .in('call_id', callIds)
          .eq('signal_type', 'INTENT_CAPTURED')
          .gte('created_at', cutoff)
          .limit(1);
        if (signals && signals.length > 0) return true;
      }
    }
  }

  return false;
}

/**
 * Evaluate and route signal.
 *
 * V1_PAGEVIEW → Redis pv:queue (value=0)
 * V2_PULSE → [dedup] → marketing_signals (Soft decay)
 * V3_ENGAGE → marketing_signals (Standard decay)
 * V4_INTENT → marketing_signals (Aggressive decay)
 * V5_SEAL → Iron Seal (valueCents/100, no decay) — caller uses value for ledger
 */
export async function evaluateAndRouteSignal(
  gear: OpsGear,
  payload: SignalPayload
): Promise<EvaluateResult> {
  const { siteId, callId, gclid, aov, clickDate, signalDate, valueCents, conversionName } = payload;

  // V1_PAGEVIEW: Redis pv:queue, value=0; meta = SECONDARY_OBSERVATION for DDA
  if (gear === 'V1_PAGEVIEW') {
    const pvId = generatePvId();
    const pvPayload = {
      siteId,
      gclid: payload.gclid || '',
      wbraid: payload.wbraid || '',
      gbraid: payload.gbraid || '',
      timestamp: signalDate.toISOString(),
      meta: { conversion_type: 'SECONDARY_OBSERVATION' },
    };
    await redis.set(`pv:data:${pvId}`, JSON.stringify(pvPayload), { ex: PV_TTL_SEC });
    await redis.lpush(`pv:queue:${siteId}`, pvId);
    return { routed: true, pvId, conversionValue: 0 };
  }

  // V5_SEAL: Iron Seal — absolute value, no decay
  if (gear === 'V5_SEAL') {
    const cents = Number(valueCents);
    const conversionValue = Number.isFinite(cents) && cents > 0 ? Math.round((cents / 100) * 100) / 100 : 0;
    return { routed: true, conversionValue };
  }

  // V2_PULSE: Dedup check
  if (gear === 'V2_PULSE') {
    const dup = await hasRecentV2Pulse(siteId, callId, gclid ?? undefined);
    if (dup) return { routed: false, conversionValue: 0, dropped: true };
  }

  // V2–V4: marketing_signals
  const conversionValue = calculateSignalEV(gear, aov, clickDate, signalDate);
  const legacyType = gearToLegacySignalType(gear);
  const name = conversionName ?? OPSMANTIK_CONVERSION_NAMES[gear];

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId ?? null,
      signal_type: legacyType,
      google_conversion_name: name,
      google_conversion_time: signalDate.toISOString(),
      conversion_value: conversionValue,
      dispatch_status: 'PENDING',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[MizanMantik] marketing_signals insert error:', error.message);
    return { routed: false, conversionValue: 0 };
  }

  return { routed: true, signalId: (data as { id: string })?.id ?? null, conversionValue };
}

/** Resolve OpsGear from legacy signal type */
export function resolveGearFromLegacy(legacy: LegacySignalType): OpsGear {
  return LEGACY_TO_OPS_GEAR[legacy];
}
