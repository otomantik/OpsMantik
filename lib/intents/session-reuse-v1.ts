/** RPC reasons that bypass strict click-chain checks (dual ingest / burst coalescing). */
export const SESSION_RPC_BURST_REUSE_REASONS = [
  'reused_recent_fingerprint_burst',
  'reused_recent_ip_entry_burst',
] as const;

/**
 * App-side acceptance for burst RPC rows. Must stay ≥ DB windows in
 * `supabase/migrations/20261225000000_intent_coalesce_window_tighten_v1.sql`
 * (`find_or_reuse_session_v1`: 45s fingerprint, 5s IP+entry) plus small skew buffer.
 */
export const INTENT_FP_BURST_SLA_MS = 50_000;
export const INTENT_IP_ENTRY_BURST_SLA_MS = 8_000;

export const ACTIVE_SINGLE_CARD_STATUSES = ['intent', 'contacted', 'offered'] as const;
export const TERMINAL_STATUSES = ['won', 'confirmed', 'junk', 'cancelled'] as const;
export const ARCHIVAL_STATUSES = ['merged'] as const;

type ReuseLifecycleStatus = (typeof ACTIVE_SINGLE_CARD_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number] | (typeof ARCHIVAL_STATUSES)[number] | 'unknown' | null;

export interface SessionReuseDecisionInput {
  siteMatches: boolean;
  primaryClickId: string | null;
  primaryClickIdValid: boolean;
  intentAction: string | null;
  candidateIntentAction: string | null;
  normalizedIntentTarget: string | null;
  candidateIntentTarget: string | null;
  timeDeltaMs: number | null;
  lifecycleStatus: string | null;
  candidateSessionId: string | null;
}

export interface SessionReuseDecision {
  reuse: boolean;
  reason: string;
  telemetry: {
    primary_click_id_present: boolean;
    intent_action: string;
    normalized_target_present: boolean;
    time_delta_ms: number | null;
    lifecycle_status: ReuseLifecycleStatus;
    candidate_session_id: string | null;
  };
}

/** Normalize RPC / DB lifecycle strings into {@link SessionReuseDecision} telemetry. */
export function normalizeSessionReuseLifecycleStatus(value: string | null | undefined): ReuseLifecycleStatus {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (ACTIVE_SINGLE_CARD_STATUSES.includes(raw as (typeof ACTIVE_SINGLE_CARD_STATUSES)[number])) return raw as ReuseLifecycleStatus;
  if (TERMINAL_STATUSES.includes(raw as (typeof TERMINAL_STATUSES)[number])) return raw as ReuseLifecycleStatus;
  if (ARCHIVAL_STATUSES.includes(raw as (typeof ARCHIVAL_STATUSES)[number])) return raw as ReuseLifecycleStatus;
  return 'unknown';
}

function normalizeLifecycle(value: string | null): ReuseLifecycleStatus {
  return normalizeSessionReuseLifecycleStatus(value);
}

function isNonEmpty(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const BURST_REASON_SET = new Set<string>(SESSION_RPC_BURST_REUSE_REASONS);

export function burstRpcSessionReuseAllowed(
  reason: string | null | undefined,
  row: { matched_session_id?: string | null; time_delta_ms?: number | null }
): boolean {
  const r = (reason ?? '').trim();
  if (!BURST_REASON_SET.has(r)) return false;
  if (!row.matched_session_id?.trim()) return false;
  const msRaw = row.time_delta_ms;
  if (typeof msRaw !== 'number' || !Number.isFinite(msRaw)) return false;
  const ms = Math.max(0, Math.round(msRaw));
  if (r === 'reused_recent_fingerprint_burst') return ms <= INTENT_FP_BURST_SLA_MS;
  if (r === 'reused_recent_ip_entry_burst') return ms <= INTENT_IP_ENTRY_BURST_SLA_MS;
  return false;
}

export function shouldReuseSessionV1(input: SessionReuseDecisionInput): SessionReuseDecision {
  const lifecycle = normalizeLifecycle(input.lifecycleStatus);
  const normalizedAction = (input.intentAction ?? '').trim().toLowerCase();
  const candidateAction = (input.candidateIntentAction ?? '').trim().toLowerCase();
  const normalizedTarget = (input.normalizedIntentTarget ?? '').trim();
  const candidateTarget = (input.candidateIntentTarget ?? '').trim();
  const primaryClickIdPresent = isNonEmpty(input.primaryClickId);

  const telemetry: SessionReuseDecision['telemetry'] = {
    primary_click_id_present: primaryClickIdPresent,
    intent_action: normalizedAction || 'unknown',
    normalized_target_present: normalizedTarget.length > 0,
    time_delta_ms: typeof input.timeDeltaMs === 'number' && Number.isFinite(input.timeDeltaMs) ? Math.max(0, Math.round(input.timeDeltaMs)) : null,
    lifecycle_status: lifecycle,
    candidate_session_id: input.candidateSessionId,
  };

  if (!input.siteMatches) return { reuse: false, reason: 'site_mismatch', telemetry };
  if (!primaryClickIdPresent) return { reuse: false, reason: 'missing_click_id', telemetry };
  if (!input.primaryClickIdValid) return { reuse: false, reason: 'invalid_click_id', telemetry };
  if (!normalizedAction || !['phone', 'whatsapp', 'form'].includes(normalizedAction)) {
    return { reuse: false, reason: 'invalid_intent_action', telemetry };
  }
  if (!normalizedTarget) return { reuse: false, reason: 'missing_normalized_target', telemetry };
  if (!input.candidateSessionId) return { reuse: false, reason: 'missing_candidate_session', telemetry };
  if (candidateAction !== normalizedAction) return { reuse: false, reason: 'intent_action_mismatch', telemetry };
  if (!candidateTarget || candidateTarget !== normalizedTarget) return { reuse: false, reason: 'intent_target_mismatch', telemetry };
  if (lifecycle && TERMINAL_STATUSES.includes(lifecycle as (typeof TERMINAL_STATUSES)[number])) {
    return { reuse: false, reason: 'terminal_status', telemetry };
  }
  if (lifecycle && ARCHIVAL_STATUSES.includes(lifecycle as (typeof ARCHIVAL_STATUSES)[number])) {
    return { reuse: false, reason: 'archival_status', telemetry };
  }
  if (telemetry.time_delta_ms == null) return { reuse: false, reason: 'missing_time_delta', telemetry };
  if (telemetry.time_delta_ms > 90_000) return { reuse: false, reason: 'time_window_exceeded', telemetry };
  if (lifecycle && !ACTIVE_SINGLE_CARD_STATUSES.includes(lifecycle as (typeof ACTIVE_SINGLE_CARD_STATUSES)[number])) {
    return { reuse: false, reason: 'inactive_status', telemetry };
  }
  return { reuse: true, reason: 'reusable_session', telemetry };
}

