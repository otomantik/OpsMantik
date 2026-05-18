import type { ClassificationContext } from './context';

export type TracePrefix =
  | 'EVIDENCE_EVAL'
  | 'CONFLICT_RES'
  | 'UA_WHISPER'
  | 'TEMPORAL'
  | 'FRAUD_GATE'
  | 'VERDICT';

export function pushTrace(ctx: ClassificationContext, prefix: TracePrefix, message: string): void {
  ctx.decision_trace.push(`${prefix}: ${message}`);
}
