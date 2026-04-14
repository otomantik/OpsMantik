/**
 * Phase 5 — Shadow identity graph edges (fingerprint digest → session).
 * Gated by IDENTITY_GRAPH_ENABLED; matcher behavior unchanged.
 */

import { createHash } from 'node:crypto';

import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

const PG_UNIQUE_VIOLATION = '23505';

export type IdentityGraphEdgeKind = 'FINGERPRINT_SESSION_BRIDGE' | 'SYNC_SESSION_RESOLVED';

export type IdentityGraphIngestSource = 'CALL_EVENT_V2' | 'SYNC_WORKER';

export interface AppendIdentityGraphEdgeInput {
  siteId: string;
  edgeKind: IdentityGraphEdgeKind;
  ingestSource: IdentityGraphIngestSource;
  /** Raw fingerprint from ingest — hashed before persist; never stored. */
  fingerprint: string;
  sessionId: string | null;
  callId?: string | null;
  correlationId?: string | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export function fingerprintDigestSha256(fingerprint: string): string {
  return createHash('sha256').update(fingerprint, 'utf8').digest('hex');
}

export async function appendIdentityGraphEdge(input: AppendIdentityGraphEdgeInput): Promise<{ appended: boolean }> {
  if (!getRefactorFlags().identity_graph_enabled) {
    return { appended: false };
  }

  const digest = fingerprintDigestSha256(input.fingerprint);

  const { error } = await adminClient.from('truth_identity_graph_edges').insert({
    site_id: input.siteId,
    edge_kind: input.edgeKind,
    ingest_source: input.ingestSource,
    fingerprint_digest: digest,
    session_id: input.sessionId,
    call_id: input.callId ?? null,
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey,
    payload: input.payload ?? {},
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { appended: false };
    }
    logWarn('appendIdentityGraphEdge failed', {
      siteId: input.siteId,
      idempotencyKey: input.idempotencyKey,
      error: error.message,
    });
    throw error;
  }

  incrementRefactorMetric('identity_graph_probe_total');
  return { appended: true };
}

export async function appendIdentityGraphEdgeBestEffort(input: AppendIdentityGraphEdgeInput): Promise<void> {
  try {
    await appendIdentityGraphEdge(input);
  } catch {
    /* best-effort */
  }
}
