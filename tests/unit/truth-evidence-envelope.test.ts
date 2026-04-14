import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TruthEnvelopeV2Schema,
  buildTruthEnvelopeV2FromLegacy,
  resolveTruthEvidencePayload,
} from '@/lib/domain/truth/truth-evidence-envelope';

test('TruthEnvelopeV2Schema: valid SYNC envelope', () => {
  const raw = {
    envelope_version: '2' as const,
    kind: 'SYNC_EVENT_PROCESSED' as const,
    provenance: {
      ingest_source: 'SYNC' as const,
      correlation_id: 'ingest-1',
      pipeline: 'worker_ingest_sync' as const,
      captured_at: new Date().toISOString(),
    },
    facts: {
      dedup_event_id: '00000000-0000-0000-0000-000000000001',
      session_id: '00000000-0000-0000-0000-000000000002',
      event_category: 'page',
      event_action: 'page_view',
      lead_score: 10,
      attribution_source: 'Google Ads',
      has_gclid: true,
    },
  };
  const p = TruthEnvelopeV2Schema.safeParse(raw);
  assert.equal(p.success, true);
});

test('TruthEnvelopeV2Schema: rejects invalid uuid in facts', () => {
  const raw = {
    envelope_version: '2' as const,
    kind: 'SYNC_EVENT_PROCESSED' as const,
    provenance: {
      ingest_source: 'SYNC' as const,
      correlation_id: null,
      pipeline: 'worker_ingest_sync' as const,
      captured_at: new Date().toISOString(),
    },
    facts: {
      dedup_event_id: 'not-a-uuid',
      session_id: '00000000-0000-0000-0000-000000000002',
      event_category: 'page',
      event_action: 'page_view',
      lead_score: 10,
      attribution_source: 'x',
      has_gclid: false,
    },
  };
  const p = TruthEnvelopeV2Schema.safeParse(raw);
  assert.equal(p.success, false);
});

test('buildTruthEnvelopeV2FromLegacy: SYNC from phase1.sync.v1', () => {
  const env = buildTruthEnvelopeV2FromLegacy({
    evidenceKind: 'SYNC_EVENT_PROCESSED',
    ingestSource: 'SYNC',
    correlationId: 'c1',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    payload: {
      schema: 'phase1.sync.v1',
      dedup_event_id: '00000000-0000-0000-0000-0000000000aa',
      session_id: '00000000-0000-0000-0000-0000000000bb',
      event_category: 'page',
      event_action: 'page_view',
      lead_score: 5,
      attribution_source: 'Direct',
      has_gclid: false,
    },
  });
  assert.ok(env);
  assert.equal(env?.kind, 'SYNC_EVENT_PROCESSED');
  assert.equal(env?.facts.lead_score, 5);
});

test('resolveTruthEvidencePayload: typed off keeps phase1', () => {
  const legacy = { schema: 'phase1.sync.v1', dedup_event_id: '00000000-0000-0000-0000-0000000000aa' };
  const r = resolveTruthEvidencePayload({
    evidenceKind: 'SYNC_EVENT_PROCESSED',
    ingestSource: 'SYNC',
    correlationId: null,
    occurredAt: new Date(),
    legacyPayload: legacy as Record<string, unknown>,
    typedEvidenceEnabled: false,
  });
  assert.equal(r.schema_version, 'phase1');
  assert.equal(r.typedEnvelopeOk, false);
  assert.equal(r.payload, legacy);
});

test('resolveTruthEvidencePayload: typed on produces phase2 when valid', () => {
  const legacy = {
    schema: 'phase1.sync.v1',
    dedup_event_id: '00000000-0000-0000-0000-0000000000aa',
    session_id: '00000000-0000-0000-0000-0000000000bb',
    event_category: 'page',
    event_action: 'page_view',
    lead_score: 1,
    attribution_source: 'Direct',
    has_gclid: false,
  };
  const r = resolveTruthEvidencePayload({
    evidenceKind: 'SYNC_EVENT_PROCESSED',
    ingestSource: 'SYNC',
    correlationId: null,
    occurredAt: new Date(),
    legacyPayload: legacy,
    typedEvidenceEnabled: true,
  });
  assert.equal(r.schema_version, 'phase2');
  assert.equal(r.typedEnvelopeOk, true);
  assert.equal((r.payload as { envelope_version?: string }).envelope_version, '2');
});
