import * as Sentry from '@sentry/nextjs';

import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logDebug } from '@/lib/logging/logger';
import { REFACTOR_PHASE_TAG } from '@/lib/version';

export type PhaseContextInput = {
  route_name: string;
  /** DB UUID when known */
  site_id?: string | null;
  /** Worker lane for ingest workers */
  ingest_lane?: string | null;
};

/**
 * Immutable snapshot for logs/Sentry (no secrets).
 */
export function buildPhaseContext(input: PhaseContextInput) {
  const flags = getRefactorFlags();
  return {
    phase_tag: REFACTOR_PHASE_TAG,
    route_name: input.route_name,
    site_id: input.site_id ?? undefined,
    ingest_lane: input.ingest_lane ?? undefined,
    truth_flags_snapshot: { ...flags },
  };
}

/**
 * Phase 0: tags + Sentry context + scaffold counter. Does not change request outcomes.
 */
export function applyRefactorObservability(input: PhaseContextInput): void {
  const ctx = buildPhaseContext(input);
  Sentry.setTag('refactor_phase', ctx.phase_tag);
  Sentry.setTag('truth_route', ctx.route_name);

  Sentry.setContext('truth_refactor', {
    phase_tag: ctx.phase_tag,
    route_name: ctx.route_name,
    site_id: ctx.site_id ?? null,
    ingest_lane: ctx.ingest_lane ?? null,
    truth_flags_snapshot: ctx.truth_flags_snapshot,
  });

  incrementRefactorMetric('truth_refactor_instrumented_touch_total');

  logDebug('REFACTOR_OBSERVABILITY', {
    phase_tag: ctx.phase_tag,
    route_name: ctx.route_name,
    site_id: ctx.site_id,
    ingest_lane: ctx.ingest_lane,
    truth_flags_snapshot: ctx.truth_flags_snapshot,
  });
}
