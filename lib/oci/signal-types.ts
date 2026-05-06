/**
 * OCI signal router types (canonical runtime surface).
 */
export type PipelineStage = 'junk' | 'contacted' | 'offered' | 'won';

export interface SignalPayload {
  siteId: string;
  callId?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  aov: number;
  clickDate: Date;
  signalDate: Date;
  valueCents?: number | null;
  systemScore?: number | null;
  conversionName?: string;
  isReversal?: boolean;
  fingerprint?: string | null;
  clientIp?: string | null;
  discriminator?: string | null;
  traceId?: string | null;
  uncertaintyBit?: boolean;
}

export interface EvaluateResult {
  routed: boolean;
  signalId?: string | null;
  pvId?: string | null;
  conversionValue: number;
  dropped?: boolean;
  causalDna?: Record<string, unknown>;
}
