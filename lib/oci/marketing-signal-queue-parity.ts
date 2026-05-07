import { enqueueOciConversionRow } from '@/lib/oci/enqueue-oci-conversion-row';
import type { EnqueueOciMicroStage } from '@/lib/oci/enqueue-oci-conversion-row';

export type ParityReasonCode =
  | 'PARITY_QUEUE_ENQUEUED'
  | 'PARITY_QUEUE_DUPLICATE'
  | 'PARITY_CONSENT_MISSING'
  | 'PARITY_QUEUE_ERROR';

export interface EnsureMarketingSignalQueueParityParams {
  siteId: string;
  callId: string;
  stage: EnqueueOciMicroStage;
  occurredAt: Date;
  leadScore: number;
  currency: string;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  consentState?: 'known' | 'unknown';
  source: string;
  traceId?: string | null;
}

export interface EnsureMarketingSignalQueueParityResult {
  parityKey: string;
  queueAttempted: boolean;
  queueEnqueued: boolean;
  queueId?: string | null;
  reasonCode: ParityReasonCode;
  retryable: boolean;
  traceId: string | null;
}

function toBucketIso(input: Date): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return 'invalid';
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export async function ensureMarketingSignalQueueParity(
  params: EnsureMarketingSignalQueueParityParams
): Promise<EnsureMarketingSignalQueueParityResult> {
  const parityKey = [
    params.siteId,
    params.callId,
    params.stage,
    toBucketIso(params.occurredAt),
    'v1',
  ].join(':');

  const result = await enqueueOciConversionRow({
    siteId: params.siteId,
    callId: params.callId,
    stage: params.stage,
    signalDate: params.occurredAt,
    intentCreatedAt: null,
    leadScore: params.leadScore,
    currency: params.currency,
    sourceOutboxEventId: null,
    gclid: params.gclid,
    wbraid: params.wbraid,
    gbraid: params.gbraid,
    discoveryMethod: params.source,
  });

  if (result.enqueued) {
    return {
      parityKey,
      queueAttempted: true,
      queueEnqueued: true,
      queueId: result.queueId ?? null,
      reasonCode: 'PARITY_QUEUE_ENQUEUED',
      retryable: false,
      traceId: params.traceId ?? null,
    };
  }

  if (result.reason === 'duplicate') {
    return {
      parityKey,
      queueAttempted: true,
      queueEnqueued: false,
      queueId: null,
      reasonCode: 'PARITY_QUEUE_DUPLICATE',
      retryable: false,
      traceId: params.traceId ?? null,
    };
  }

  if (result.reason === 'CONSENT_MISSING') {
    return {
      parityKey,
      queueAttempted: true,
      queueEnqueued: false,
      queueId: null,
      reasonCode: 'PARITY_CONSENT_MISSING',
      retryable: false,
      traceId: params.traceId ?? null,
    };
  }

  return {
    parityKey,
    queueAttempted: true,
    queueEnqueued: false,
    queueId: null,
    reasonCode: 'PARITY_QUEUE_ERROR',
    retryable: true,
    traceId: params.traceId ?? null,
  };
}
