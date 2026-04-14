export { ENGINE_CONTRACT_VERSION, type DeterministicEngineProbeKind, type PaidSurfaceBucket } from '@/lib/domain/deterministic-engine/contract';
export { runDeterministicEngineProbe, type DeterministicEngineProbeContext } from '@/lib/domain/deterministic-engine/probe';
export { runAttributionPaidSurfaceParity, type AttributionPaidSurfaceParityInput } from '@/lib/domain/deterministic-engine/parity-attribution';
export { buildClassifierParamsForParity } from '@/lib/domain/deterministic-engine/parity-params';
export {
  paidSurfaceFromAttributionResult,
  paidSurfaceFromTrafficClassificationV1,
} from '@/lib/domain/deterministic-engine/paid-surface';
export { comparePaidSurfaceBuckets } from '@/lib/domain/deterministic-engine/parity-compare';
export { buildClassifierParamsForCallEventParity } from '@/lib/domain/deterministic-engine/call-event-parity-params';
export { paidSurfaceFromCallEventSourceType } from '@/lib/domain/deterministic-engine/call-event-paid-surface';
export { runCallEventPaidSurfaceParity, type CallEventPaidSurfaceParityInput } from '@/lib/domain/deterministic-engine/parity-call-event';
export {
  deriveCallEventAuthoritativePaidOrganic,
  type CallEventSanitizedIds,
} from '@/lib/domain/deterministic-engine/call-event-authoritative-source';
