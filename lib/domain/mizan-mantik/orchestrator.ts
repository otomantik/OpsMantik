/**
 * MizanMantik — Domain Orchestrator
 *
 * Gatekeeper and Ledger Router. Not a calculator — routes signals.
 * V1: Redis (value=0). V2-V4: marketing_signals (decay). V5: Iron Seal (no decay).
 *
 * Singularity: Every branch appends to Causal DNA; dropped paths logged to shadow_decisions.
 */

import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { redis } from '@/lib/upstash';
import { calculateDecayDays } from '@/lib/shared/time-utils';
import { calculateSignalEV, applyHalfLifeDecay, GEAR_TO_STAGE } from './time-decay';
import { getSiteValueConfig, getValueFloorCents } from './value-config';
import { createCausalDna, appendBranch, toJsonb } from './causal-dna';
import { getEntropyScore } from './entropy-service';
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

/** Fire-and-forget shadow decision log (path not taken). */
function logShadowDecision(
  siteId: string,
  aggregateType: 'conversion' | 'signal' | 'pv',
  aggregateId: string | null,
  rejectedBranch: string,
  reason: string,
  context: Record<string, unknown> = {}
): void {
  void adminClient
    .rpc('insert_shadow_decision', {
      p_site_id: siteId,
      p_aggregate_type: aggregateType,
      p_aggregate_id: aggregateId,
      p_rejected_gear_or_branch: rejectedBranch,
      p_reason: reason,
      p_context: context,
    })
    .then(() => { /* best-effort */ }, () => { /* best-effort */ });
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
  const { siteId, callId, gclid, aov, clickDate, signalDate, valueCents, conversionName, fingerprint, discriminator } = payload;
  const { score: entropyScore, uncertaintyBit } = await getEntropyScore(fingerprint ?? null);
  let dna = createCausalDna(gear, ['auth']);

  // V1_PAGEVIEW: Redis pv:queue, value=0; meta = SECONDARY_OBSERVATION for DDA
  if (gear === 'V1_PAGEVIEW') {
    dna = appendBranch(dna, 'V1_PAGEVIEW_Redis', ['auth', 'idempotency', 'pv_queue'], {
      signalDate: signalDate.toISOString(),
      gclid: payload.gclid ?? null,
      wbraid: payload.wbraid ?? null,
      gbraid: payload.gbraid ?? null,
    }, { destination: 'pv:queue', value: 0 });
    const pvId = generatePvId();
    const pvPayload = {
      siteId,
      gclid: payload.gclid || '',
      wbraid: payload.wbraid || '',
      gbraid: payload.gbraid || '',
      timestamp: signalDate.toISOString(),
      meta: { conversion_type: 'SECONDARY_OBSERVATION' },
    };
    const pvQueueKey = `pv:queue:${siteId}`;
    const pipeline = redis.pipeline();
    pipeline.lpush(pvQueueKey, pvId);
    pipeline.expire(pvQueueKey, PV_TTL_SEC);
    await pipeline.exec();
    await redis.set(`pv:data:${pvId}`, JSON.stringify(pvPayload), { ex: PV_TTL_SEC });
    return { routed: true, pvId, conversionValue: 0, causalDna: toJsonb(dna) };
  }

  // V2–V5: Require site configuration for value & weights
  const config = await getSiteValueConfig(siteId);

  // Phase 19: Forensic SST & Geo-Fence Reinforcement
  const clientIp = payload.clientIp;
  if (!clientIp) {
    dna = appendBranch(dna, 'SST_HEADER_FAIL', ['audit'], {}, { reason: 'missing_xff' });
  } else {
    // Basic Geo-Fence for TR sites (Düsseldorf Paradox prevention)
    const isTurkishSite =
      (config.siteName || '').includes('Muratcan') ||
      (config.siteName || '').includes('Yap') ||
      siteId === 'e0f47012-7dec-11d0-a765-00a0c91e6bf6'; // Muratcan Akü / Mock
    if (isTurkishSite) {
      // Trace Geo-Fence context in DNA
      dna = appendBranch(dna, 'GEO_FENCE_TR_CHECK', ['audit'], { clientIp }, { isTurkishSite });
    }
  }

  // V5_SEAL: Iron Seal — absolute value or AOV Floor (The 1000 TL Axiom)
  if (gear === 'V5_SEAL') {
    let cents = Number(valueCents);
    if (!Number.isFinite(cents) || cents <= 0) {
      cents = config.minConversionValueCents;
    }
    const conversionValue = Math.round((cents / 100) * 100) / 100;
    dna = appendBranch(dna, 'V5_SEAL_Standard_Conversion', ['auth', 'idempotency', 'usage'], { valueCents: cents, raw: valueCents, fallback: cents !== Number(valueCents) }, { conversionValue, math_version: 'v1.0.5' });
    return { routed: true, conversionValue, causalDna: toJsonb(dna) };
  }

  // V2_PULSE: Dedup check — skip if discriminator present (Axiom 3: multiple intents per session)
  if (gear === 'V2_PULSE') {
    const hasDiscriminator = discriminator != null && String(discriminator).trim() !== '';
    if (!hasDiscriminator) {
      const dup = await hasRecentV2Pulse(siteId, callId, gclid ?? undefined);
      if (dup) {
        dna = appendBranch(dna, 'V2_PULSE_Dropped', ['auth', 'dedup_fail'], { callId, gclid: gclid ?? null }, { reason: 'hasRecentV2Pulse' });
        logShadowDecision(siteId, 'signal', null, 'V2_PULSE', 'hasRecentV2Pulse: duplicate pulse in 24h', { callId: callId ?? null, gclid: gclid ?? null });
        return { routed: false, conversionValue: 0, dropped: true, causalDna: toJsonb(dna) };
      }
      dna = appendBranch(dna, 'V2_PULSE_DedupPass', ['auth', 'dedup'], {}, {});
    } else {
      dna = appendBranch(dna, 'V2_PULSE_DiscriminatorPass', ['auth', 'dedup_bypass'], { discriminator }, {});
    }
  }

  // V2–V4: marketing_signals (PR-VK-7: integer cents SSOT; MODULE 3: ratio-based floor)
  const effectiveAovMajor = config.defaultAov ?? aov ?? 0;
  const aovCents = Math.round(Number(effectiveAovMajor) * 100);
  let finalCents = calculateSignalEV(gear, aovCents, clickDate, signalDate, config.intentWeights);
  const floorCents = getValueFloorCents(config);
  if (finalCents < floorCents) finalCents = floorCents;
  const conversionValue = finalCents / 100; // Major unit for API / Google Ads
  const days = calculateDecayDays(clickDate, signalDate, 'ceil');

  // MODULE 4: Half-life shadow mode — compute and log, do NOT use for send
  const stage = GEAR_TO_STAGE[gear];
  const ratio = stage ? (config.intentWeights[stage] ?? 0.02) : 0;
  const baseValueCents = Math.round(aovCents * ratio);
  const halfLifeCents = applyHalfLifeDecay(baseValueCents, days);
  logShadowDecision(siteId, 'signal', null, 'HALFLIFE_SHADOW', 'Shadow: half-life value for 30d comparison', {
    discrete_cents: finalCents,
    half_life_cents: halfLifeCents,
    days,
    gear,
  });

  dna = appendBranch(dna, `${gear}_marketing_signals`, ['auth', 'idempotency', 'usage'], { aovCents, clickDate: clickDate.toISOString(), signalDate: signalDate.toISOString(), days }, { conversionValue, finalCents, days, logic_branch: 'Standard_Decay' });
  const legacyType = gearToLegacySignalType(gear);
  const name = conversionName ?? OPSMANTIK_CONVERSION_NAMES[gear];
  const causalDnaJson = toJsonb(dna);

  // Phase 8.1: Append-Only Ledger Sequence & Merkle Logic
  // Automatically increment adjustment_sequence and chain hashes.
  let sequence = 0;
  let previousHash: string | null = null;

  if (callId) {
    const { data: existing } = await adminClient
      .from('marketing_signals')
      .select('adjustment_sequence, current_hash')
      .eq('site_id', siteId)
      .eq('call_id', callId)
      .eq('google_conversion_name', name)
      .order('adjustment_sequence', { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      sequence = (existing[0].adjustment_sequence ?? 0) + 1;
      previousHash = existing[0].current_hash ?? null;
    }
  }

  // Cryptographic Ledger Verification Hash
  const salt = process.env.VOID_LEDGER_SALT || 'void_consensus_salt_insecure';
  const hashPayload = `${callId ?? 'null'}:${sequence}:${finalCents}:${previousHash ?? 'null'}:${salt}`;
  const currentHash = createHash('sha256').update(hashPayload).digest('hex');

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId ?? null,
      signal_type: legacyType,
      google_conversion_name: name,
      google_conversion_time: signalDate.toISOString(),
      expected_value_cents: finalCents,
      conversion_value: conversionValue,
      dispatch_status: 'PENDING',
      causal_dna: causalDnaJson,
      entropy_score: entropyScore,
      uncertainty_bit: uncertaintyBit,
      adjustment_sequence: sequence,
      previous_hash: previousHash,
      current_hash: currentHash,
    })
    .select('id')
    .single();

  if (error) {
    // PR-OCI-3: Unique violation (23505) = duplicate (site, call, gear, sequence) → idempotent success
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      dna = appendBranch(dna, 'marketing_signals_duplicate_ignored', ['auth', 'idempotency'], { callId: callId ?? null, sequence, hash: currentHash }, {});
      return { routed: true, conversionValue, causalDna: toJsonb(dna) };
    }
    console.error('[MizanMantik] marketing_signals insert error:', error.message);
    dna = appendBranch(dna, 'marketing_signals_insert_failed', [], {}, { error: error.message });
    return { routed: false, conversionValue: 0, causalDna: toJsonb(dna) };
  }

  const signalId = (data as { id: string })?.id ?? null;
  void adminClient
    .rpc('append_causal_dna_ledger', {
      p_site_id: siteId,
      p_aggregate_type: 'signal',
      p_aggregate_id: signalId,
      p_causal_dna: causalDnaJson,
    })
    .then(() => { }, (err: unknown) => console.error('[MizanMantik] append_causal_dna_ledger failed:', err));
  return { routed: true, signalId, conversionValue, causalDna: causalDnaJson };
}

/** Resolve OpsGear from legacy signal type */
export function resolveGearFromLegacy(legacy: LegacySignalType): OpsGear {
  return LEGACY_TO_OPS_GEAR[legacy];
}
