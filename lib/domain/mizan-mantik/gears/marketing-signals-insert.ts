/**
 * Phase 20: Shared marketing_signals insert for V2–V4 gears
 */

import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { calculateDecayDays } from '@/lib/shared/time-utils';
import { calculateSignalEV, applyHalfLifeDecay, GEAR_TO_STAGE } from '../time-decay';
import { getValueFloorCents } from '../value-config';
import type { ValueConfig } from '../value-config';
import type { OpsGear, SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import { appendBranch, toJsonb } from '../causal-dna';
import { OPSMANTIK_CONVERSION_NAMES } from '../conversion-names';
import { logShadowDecision, appendCausalDnaLedgerSafe } from './shared';
import { logError, logInfo } from '@/lib/logging/logger';
import { resolveSignalOccurredAt } from '@/lib/oci/occurred-at';

function gearToLegacySignalType(gear: OpsGear): string {
  switch (gear) {
    case 'V2_PULSE': return 'INTENT_CAPTURED';
    case 'V3_ENGAGE': return 'MEETING_BOOKED';
    case 'V4_INTENT': return 'SEAL_PENDING';
    default: return 'OpsMantik_Signal';
  }
}

export interface InsertMarketingSignalParams {
  siteId: string;
  callId: string | null;
  traceId: string | null;
  gear: OpsGear;
  payload: SignalPayload;
  config: ValueConfig | null;
  dna: CausalDna;
  entropyScore: number;
  uncertaintyBit: boolean | null;
}

export async function insertMarketingSignal(params: InsertMarketingSignalParams): Promise<{
  success: boolean;
  signalId?: string | null;
  conversionValue: number;
  causalDna: Record<string, unknown>;
  duplicate?: boolean;
}> {
  const { siteId, callId, traceId, gear, payload, config, dna, entropyScore, uncertaintyBit } = params;
  const { aov, clickDate, signalDate, conversionName, gclid, wbraid, gbraid } = payload;

  const effectiveAovMajor = config?.defaultAov ?? aov ?? 0;
  const aovCents = Math.round(Number(effectiveAovMajor) * 100);
  const computedCents = calculateSignalEV(gear, aovCents, clickDate, signalDate, config?.intentWeights);
  const floorCents = config ? getValueFloorCents(config) : 100;
  let finalCents = computedCents;
  if (finalCents < floorCents) {
    finalCents = floorCents;
    logInfo('SIGNAL_VALUE_FLOOR_APPLIED', {
      site_id: siteId,
      gear,
      computed_cents: computedCents,
      floor_cents: floorCents,
      applied_cents: finalCents,
      site_min_conversion_value_cents: config?.minConversionValueCents ?? null,
    });
  }
  const conversionValue = finalCents / 100;
  const days = calculateDecayDays(clickDate, signalDate, 'ceil');

  const stage = GEAR_TO_STAGE[gear];
  const ratio = stage && config ? (config.intentWeights[stage] ?? 0.02) : 0;
  const baseValueCents = Math.round(aovCents * ratio);
  const halfLifeCents = applyHalfLifeDecay(baseValueCents, days);
  logShadowDecision(siteId, 'signal', null, 'HALFLIFE_SHADOW', 'Shadow: half-life value for 30d comparison', {
    discrete_cents: finalCents,
    half_life_cents: halfLifeCents,
    days,
    gear,
  });

  let dnaOut = appendBranch(dna, `${gear}_marketing_signals`, ['auth', 'idempotency', 'usage'],
    { aovCents, clickDate: clickDate.toISOString(), signalDate: signalDate.toISOString(), days },
    { conversionValue, finalCents, days, logic_branch: 'Standard_Decay' });

  const legacyType = gearToLegacySignalType(gear);
  const name = conversionName ?? OPSMANTIK_CONVERSION_NAMES[gear];
  const causalDnaJson = toJsonb(dnaOut);
  const occurredAtMeta = resolveSignalOccurredAt(signalDate, gear);

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

  const salt = process.env.VOID_LEDGER_SALT || 'void_consensus_salt_insecure';
  const hashPayload = `${callId ?? 'null'}:${sequence}:${finalCents}:${previousHash ?? 'null'}:${salt}`;
  const currentHash = createHash('sha256').update(hashPayload).digest('hex');

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId,
      trace_id: traceId,
      signal_type: legacyType,
      google_conversion_name: name,
      google_conversion_time: signalDate.toISOString(),
      occurred_at: occurredAtMeta.occurredAt,
      source_timestamp: occurredAtMeta.sourceTimestamp,
      time_confidence: occurredAtMeta.timeConfidence,
      occurred_at_source: occurredAtMeta.occurredAtSource,
      expected_value_cents: finalCents,
      conversion_value: conversionValue,
      dispatch_status: 'PENDING',
      causal_dna: causalDnaJson,
      entropy_score: entropyScore,
      uncertainty_bit: uncertaintyBit,
      gclid: gclid ?? null,
      wbraid: wbraid ?? null,
      gbraid: gbraid ?? null,
      adjustment_sequence: sequence,
      previous_hash: previousHash,
      current_hash: currentHash,
    })
    .select('id')
    .single();

  if (error) {
    const code = (error as { code?: string })?.code;
    if (code === '23505') {
      dnaOut = appendBranch(dnaOut, 'marketing_signals_duplicate_ignored', ['auth', 'idempotency'],
        { callId, sequence, hash: currentHash }, {});
      return { success: true, conversionValue, causalDna: toJsonb(dnaOut), duplicate: true };
    }
    logError('MARKETING_SIGNALS_INSERT_FAILED', { error: error.message, code: error.code });
    dnaOut = appendBranch(dnaOut, 'marketing_signals_insert_failed', [], {}, { error: error.message });
    return { success: false, conversionValue: 0, causalDna: toJsonb(dnaOut) };
  }

  const signalId = (data as { id: string })?.id ?? null;
  appendCausalDnaLedgerSafe(siteId, 'signal', signalId, causalDnaJson);

  return { success: true, signalId, conversionValue, causalDna: causalDnaJson };
}
