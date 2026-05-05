/**
 * POST `/api/intents/[id]/status` — declarative surface vs `apply_call_action_with_review_v1`.
 *
 * Only a subset of historical queue “status” labels are executable here. Others belong to
 * `/api/intents/[id]/stage` (scored funnel), `/api/calls/[id]/seal` (won/confirmed lineage), etc.
 */

import {
  INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED,
  STATUS_ROUTE_EXECUTABLE_STATUSES,
  STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES,
} from '@/lib/domain/intents/status-taxonomy';

export const INTENT_STATUS_ROUTE_UNSUPPORTED_REASON =
  'This status is recognized but cannot be applied through this endpoint.' as const;

/** Values this route recognizes (normalized lowercase). Executable ⊂ recognized. SSOT tuples in status-taxonomy. */
export const INTENT_STATUS_ROUTE_RECOGNIZED =
  INTENT_POST_STATUS_ROUTE_RECOGNIZED_ORDERED;

export type IntentStatusRouteRecognized =
  (typeof INTENT_STATUS_ROUTE_RECOGNIZED)[number];

/** Status labels this route applies via `apply_call_action_with_review_v1`. */
export const INTENT_STATUS_ROUTE_EXECUTABLE = STATUS_ROUTE_EXECUTABLE_STATUSES;

export type IntentStatusRouteExecutable =
  (typeof STATUS_ROUTE_EXECUTABLE_STATUSES)[number];

/** Recognized-only (use stage / seal / other surfaces). */
export const INTENT_STATUS_ROUTE_UNSUPPORTED =
  STATUS_ROUTE_UNSUPPORTED_RECOGNIZED_STATUSES;

const RECOGNIZED_SET = new Set<string>(INTENT_STATUS_ROUTE_RECOGNIZED);

export type IntentStatusRouteVerdict =
  | {
      kind: 'invalid';
      normalized: string | null;
      code: 'INVALID_STATUS';
      reason: string;
    }
  | {
      kind: 'unsupported';
      normalized: IntentStatusRouteRecognized;
      code: 'UNSUPPORTED_STATUS';
      reason: typeof INTENT_STATUS_ROUTE_UNSUPPORTED_REASON;
    }
  | {
      kind: 'executable';
      normalized: IntentStatusRouteExecutable;
      actionType: 'junk' | 'cancel' | 'restore';
      /** Stage passed through to `apply_call_action_with_review_v1` (`p_stage`). */
      rpcStage: 'junk' | 'contacted';
      reviewed: boolean;
    };

export function normalizeIntentRouteStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

/**
 * Compatibility: API `cancelled` maps to the same **`junk`** disposition RPC stage as Junk
 * (persists `calls.status = 'junk'`). Do not infer `calls.status = 'cancelled'` from this route.
 */
export function classifyIntentStatusRoute(
  normalized: string | null
): IntentStatusRouteVerdict {
  if (normalized === null) {
    return {
      kind: 'invalid',
      normalized: null,
      code: 'INVALID_STATUS',
      reason: 'Missing or empty status.',
    };
  }

  if (!RECOGNIZED_SET.has(normalized)) {
    return {
      kind: 'invalid',
      normalized,
      code: 'INVALID_STATUS',
      reason: `Unknown status "${normalized}".`,
    };
  }

  const recognized = normalized as IntentStatusRouteRecognized;

  if (
    recognized === 'confirmed' ||
    recognized === 'qualified' ||
    recognized === 'real' ||
    recognized === 'suspicious'
  ) {
    return {
      kind: 'unsupported',
      normalized: recognized,
      code: 'UNSUPPORTED_STATUS',
      reason: INTENT_STATUS_ROUTE_UNSUPPORTED_REASON,
    };
  }

  if (recognized === 'junk') {
    return {
      kind: 'executable',
      normalized: 'junk',
      actionType: 'junk',
      rpcStage: 'junk',
      reviewed: true,
    };
  }

  if (recognized === 'cancelled') {
    return {
      kind: 'executable',
      normalized: 'cancelled',
      actionType: 'cancel',
      rpcStage: 'junk',
      reviewed: true,
    };
  }

  return {
    kind: 'executable',
    normalized: 'intent',
    actionType: 'restore',
    rpcStage: 'contacted',
    reviewed: false,
  };
}
