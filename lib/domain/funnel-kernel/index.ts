/**
 * Funnel Kernel — Event-sourced V2–V5 funnel, projection, policy.
 * See: docs/architecture/FUNNEL_CONTRACT.md
 */

export { appendFunnelEvent, type AppendFunnelEventInput, type FunnelEventType, type FunnelEventSource } from './ledger-writer';
export { processCallProjection, type CallFunnelProjection, type ProjectionStage } from './projection-updater';
export {
  getStageWeight,
  getQualityWeight,
  getConfidenceWeight,
  computeExportValue,
  type ProjectionForValue,
} from './funnel-policy';
export { computeSealedValue } from './value-formula';
