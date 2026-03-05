/**
 * Phase 20: V1_PAGEVIEW — Redis pv:queue, value=0
 */

import { createHash } from 'node:crypto';
import { redis } from '@/lib/upstash';
import { appendBranch, toJsonb } from '../causal-dna';
import { createCausalDna } from '../causal-dna';
import type { SignalPayload } from '../types';
import type { CausalDna } from '../causal-dna';
import type { AbstractGear, GearContext, PreValidateResult } from './AbstractGear';
import type { EvaluateResult } from '../types';

const PV_TTL_SEC = 7 * 24 * 60 * 60;

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
    }, { destination: 'pv:queue', value: 0 });
    return { pass: true, dna };
  }

  calculateEconomicValue(): number {
    return 0;
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
}
