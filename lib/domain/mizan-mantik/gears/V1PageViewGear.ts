/**
 * Phase 20: V1_PAGEVIEW — Redis pv:queue, visibility value = 1 minor unit
 */

import { redis } from '@/lib/upstash';
import { appendBranch, toJsonb } from '../causal-dna';
import type { SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import type { AbstractGear, GearContext, PreValidateResult } from './AbstractGear';
import type { EvaluateResult } from '../types';
import { getPvDataKey, getPvQueueKey } from '@/lib/oci/pv-redis';

const PV_TTL_SEC = 7 * 24 * 60 * 60;
const V1_PAGEVIEW_VISIBILITY_MINOR = 1;
const V1_PAGEVIEW_VISIBILITY_VALUE = 0.01;

function generatePvId(): string {
  return 'pv_' + crypto.randomUUID().replace(/-/g, '');
}

export class V1PageViewGear implements AbstractGear {
  readonly gear = 'V1_PAGEVIEW' as const;

  async preValidate(
    payload: SignalPayload,
    dna: CausalDna,
    _context: GearContext
  ): Promise<PreValidateResult> {
    dna = appendBranch(dna, 'V1_PAGEVIEW_Redis', ['auth', 'idempotency', 'pv_queue'], {
      signalDate: payload.signalDate.toISOString(),
      gclid: payload.gclid ?? null,
      wbraid: payload.wbraid ?? null,
      gbraid: payload.gbraid ?? null,
    }, { destination: 'pv:queue', value: V1_PAGEVIEW_VISIBILITY_VALUE });
    return { pass: true, dna };
  }

  calculateEconomicValue(): number {
    return V1_PAGEVIEW_VISIBILITY_VALUE;
  }

  generateCausalDNA(dna: CausalDna): CausalDna {
    return dna;
  }

  async route(
    payload: SignalPayload,
    dna: CausalDna,
    context: GearContext
  ): Promise<EvaluateResult> {
    const { siteId } = context;
    const pvId = generatePvId();
    const pvPayload = {
      siteId,
      gclid: payload.gclid || '',
      wbraid: payload.wbraid || '',
      gbraid: payload.gbraid || '',
      timestamp: payload.signalDate.toISOString(),
      conversionValueMinor: V1_PAGEVIEW_VISIBILITY_MINOR,
      conversionValue: V1_PAGEVIEW_VISIBILITY_VALUE,
      meta: { conversion_type: 'SECONDARY_OBSERVATION' },
    };
    const pvQueueKey = getPvQueueKey(siteId);
    const pipeline = redis.pipeline();
    pipeline.lpush(pvQueueKey, pvId);
    pipeline.expire(pvQueueKey, PV_TTL_SEC);
    await pipeline.exec();
    await redis.set(getPvDataKey(pvId), JSON.stringify(pvPayload), { ex: PV_TTL_SEC });
    return { routed: true, pvId, conversionValue: V1_PAGEVIEW_VISIBILITY_VALUE, causalDna: toJsonb(dna) };
  }
}
