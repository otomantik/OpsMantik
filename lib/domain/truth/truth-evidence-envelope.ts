/**
 * Phase 2 — Typed evidence envelope (v2) + provenance for truth_evidence_ledger.payload.
 * Validated in shadow mode when TRUTH_TYPED_EVIDENCE_ENABLED; invalid → legacy phase1 payload + metric.
 */

import { z } from 'zod';

export type TruthEvidenceKind = 'SYNC_EVENT_PROCESSED' | 'CALL_EVENT_CALL_INSERTED';

export type TruthIngestSource = 'SYNC' | 'CALL_EVENT';

/** Relaxed UUID string (Zod 4's .uuid() rejects some DB/namespace UUIDs with version nibble 0). */
const uuidStr = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  'expected uuid string'
);

export const ProvenanceV2Schema = z.object({
  ingest_source: z.enum(['SYNC', 'CALL_EVENT']),
  correlation_id: z.string().max(512).nullable(),
  pipeline: z.enum(['worker_ingest_sync', 'worker_ingest_call_event']),
  /** ISO-8601 instant from occurredAt */
  captured_at: z.string().min(20).max(64),
});

export const SyncFactsV2Schema = z.object({
  dedup_event_id: uuidStr,
  session_id: uuidStr,
  event_category: z.string().max(128),
  event_action: z.string().max(128),
  lead_score: z.number().finite(),
  attribution_source: z.string().max(120),
  has_gclid: z.boolean(),
});

export const CallEventFactsV2Schema = z.object({
  call_id: uuidStr,
  event_id: uuidStr.nullable(),
  has_phone: z.boolean(),
  source_type: z.enum(['paid', 'organic']),
  intent_action: z.string().max(128).nullable(),
});

export const TruthEnvelopeV2Schema = z.union([
  z.object({
    envelope_version: z.literal('2'),
    kind: z.literal('SYNC_EVENT_PROCESSED'),
    provenance: ProvenanceV2Schema,
    facts: SyncFactsV2Schema,
  }),
  z.object({
    envelope_version: z.literal('2'),
    kind: z.literal('CALL_EVENT_CALL_INSERTED'),
    provenance: ProvenanceV2Schema,
    facts: CallEventFactsV2Schema,
  }),
]);

export type TruthEnvelopeV2 = z.infer<typeof TruthEnvelopeV2Schema>;

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

/**
 * Build v2 envelope from legacy phase1 payloads produced by process-sync-event / process-call-event.
 * Returns null if shape is unknown (caller should persist legacy only).
 */
export function buildTruthEnvelopeV2FromLegacy(input: {
  evidenceKind: TruthEvidenceKind;
  ingestSource: TruthIngestSource;
  correlationId: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
}): TruthEnvelopeV2 | null {
  const { evidenceKind, ingestSource, correlationId, occurredAt, payload } = input;
  const cap = occurredAt.toISOString();
  const schema = payload.schema;

  if (evidenceKind === 'SYNC_EVENT_PROCESSED' && schema === 'phase1.sync.v1' && ingestSource === 'SYNC') {
    return {
      envelope_version: '2',
      kind: 'SYNC_EVENT_PROCESSED',
      provenance: {
        ingest_source: 'SYNC',
        correlation_id: correlationId,
        pipeline: 'worker_ingest_sync',
        captured_at: cap,
      },
      facts: {
        dedup_event_id: String(payload.dedup_event_id ?? ''),
        session_id: String(payload.session_id ?? ''),
        event_category: String(payload.event_category ?? ''),
        event_action: String(payload.event_action ?? ''),
        lead_score: typeof payload.lead_score === 'number' ? payload.lead_score : Number(payload.lead_score),
        attribution_source: String(payload.attribution_source ?? ''),
        has_gclid: Boolean(payload.has_gclid),
      },
    };
  }

  if (evidenceKind === 'CALL_EVENT_CALL_INSERTED' && schema === 'phase1.call_event.v1' && ingestSource === 'CALL_EVENT') {
    const eventId = asString(payload.event_id);
    return {
      envelope_version: '2',
      kind: 'CALL_EVENT_CALL_INSERTED',
      provenance: {
        ingest_source: 'CALL_EVENT',
        correlation_id: correlationId,
        pipeline: 'worker_ingest_call_event',
        captured_at: cap,
      },
      facts: {
        call_id: String(payload.call_id ?? ''),
        event_id: eventId && /^[0-9a-f-]{36}$/i.test(eventId) ? eventId : null,
        has_phone: Boolean(payload.has_phone),
        source_type: payload.source_type === 'organic' ? 'organic' : 'paid',
        intent_action: asString(payload.intent_action),
      },
    };
  }

  return null;
}

export type ResolvedTruthPayload = {
  payload: Record<string, unknown>;
  schema_version: 'phase1' | 'phase2';
  typedEnvelopeOk: boolean;
};

/**
 * When TRUTH_TYPED_EVIDENCE_ENABLED: validate v2 envelope; on failure fall back to legacy phase1 (same row semantics).
 */
export function resolveTruthEvidencePayload(input: {
  evidenceKind: TruthEvidenceKind;
  ingestSource: TruthIngestSource;
  correlationId: string | null;
  occurredAt: Date;
  legacyPayload: Record<string, unknown>;
  typedEvidenceEnabled: boolean;
}): ResolvedTruthPayload {
  const { legacyPayload, typedEvidenceEnabled } = input;

  if (!typedEvidenceEnabled) {
    return { payload: legacyPayload, schema_version: 'phase1', typedEnvelopeOk: false };
  }

  const built = buildTruthEnvelopeV2FromLegacy({
    evidenceKind: input.evidenceKind,
    ingestSource: input.ingestSource,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    payload: legacyPayload,
  });

  if (!built) {
    return { payload: legacyPayload, schema_version: 'phase1', typedEnvelopeOk: false };
  }

  const parsed = TruthEnvelopeV2Schema.safeParse(built);
  if (parsed.success) {
    return {
      payload: parsed.data as unknown as Record<string, unknown>,
      schema_version: 'phase2',
      typedEnvelopeOk: true,
    };
  }

  return { payload: legacyPayload, schema_version: 'phase1', typedEnvelopeOk: false };
}
