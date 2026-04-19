/**
 * MizanMantik - Domain Types (Canonical Configuration)
 */

/**
 * PipelineStage — Alias of `OptimizationStage`.
 *
 * Canonical English-only spellings post global-launch cutover:
 *   'junk' | 'contacted' | 'offered' | 'won'
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
  conversionName?: string;
  /** Singularity: optional fingerprint (e.g. hash(IP+UA)) for entropy_score / uncertainty_bit */
  fingerprint?: string | null;
  /** Real client IP from SST headers (XFF) for geo-fencing and forensic trace */
  clientIp?: string | null;
  /** Historical field retained for compatibility with older payloads. */
  discriminator?: string | null;
  /** OM-TRACE-UUID for forensic chain and conversion_custom_variable */
  traceId?: string | null;
}

export interface EvaluateResult {
  routed: boolean;
  signalId?: string | null;
  pvId?: string | null;
  conversionValue: number;
  dropped?: boolean;
  /** Singularity: Decision DNA for non-repudiable trace */
  causalDna?: Record<string, unknown>;
}
