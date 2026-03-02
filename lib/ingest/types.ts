/**
 * Deterministic type-safety for ingest pipeline (PR-B).
 * Discriminated union for ingest outcomes; CausalDna for processed events.
 */

/** Minimal causal identity for a processed sync event (score + optional session/event refs). */
export interface CausalDna {
  score: number;
  sessionId?: string;
  sessionMonth?: string;
  dedupEventId?: string;
}

/** Skip reasons for traffic-debloat path (discriminated union literals). */
export type IngestSkipReason = 'BOT_UA' | 'REFERRER_DENIED';

/**
 * Discriminated union for ingest result.
 * - PROCESSED: event persisted; billable; includes CausalDna.
 * - SKIPPED: bot/referrer gate; not billable; reason required.
 * - FAILED: error path; error message required.
 */
export type IngestResult =
  | { status: 'PROCESSED'; dna: CausalDna; billable: true }
  | { status: 'SKIPPED'; reason: IngestSkipReason; billable: false }
  | { status: 'FAILED'; error: string };

/** Event kinds used for exhaustive matching in process-sync-event. */
export type IngestEventKind = 'heartbeat' | 'page_view' | 'click' | 'call_intent' | 'other';

/** Exhaustive check: ensures every union member is handled. Add new event kinds to IngestEventKind and to the switch. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled ingest event kind: ${String(value)}`);
}
