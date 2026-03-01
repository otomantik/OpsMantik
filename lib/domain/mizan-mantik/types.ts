/**
 * MizanMantik 5-Gear - Domain Types
 */

export type OpsGear =
  | 'V1_PAGEVIEW'
  | 'V2_PULSE'
  | 'V3_ENGAGE'
  | 'V4_INTENT'
  | 'V5_SEAL';

export type LegacySignalType = 'INTENT_CAPTURED' | 'MEETING_BOOKED' | 'SEAL_PENDING';

export const LEGACY_TO_OPS_GEAR: Record<LegacySignalType, OpsGear> = {
  INTENT_CAPTURED: 'V2_PULSE',
  MEETING_BOOKED: 'V3_ENGAGE',
  SEAL_PENDING: 'V4_INTENT',
};

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
}

export interface EvaluateResult {
  routed: boolean;
  signalId?: string | null;
  pvId?: string | null;
  conversionValue: number;
  dropped?: boolean;
}
