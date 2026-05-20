/**
 * SEAL-04A — Install Center readiness states (pure, read-only).
 * Some states require data we do not yet expose; those map to `unknown` at runtime.
 */

export type InstallReadinessState =
  | 'not_installed'
  | 'installed_no_events'
  | 'events_received'
  | 'intent_events_received'
  | 'conversion_ready'
  | 'no_heartbeat'
  | 'origin_mismatch'
  | 'consent_missing'
  | 'script_outdated'
  | 'unknown';

export type InstallHealthInput = {
  originCount: number;
  originVerified: boolean | null;
  lastEventAt: string | null;
  lastEventAction: string | null;
  lastHeartbeatAt: string | null;
  trafficReceiving: boolean | null;
  hasIntentCalls: boolean;
  /** Canonical embed version from tracker-embed (e.g. "7"). */
  scriptVersion: string | null;
  /** Future: compare live site script version vs canonical. */
  liveScriptVersion: string | null;
  /** Future: consent scope telemetry — null means unknown. */
  consentAnalyticsPresent: boolean | null;
};

export function deriveInstallReadiness(input: InstallHealthInput): InstallReadinessState {
  if (input.originCount === 0 && !input.lastEventAt) {
    return 'not_installed';
  }

  if (input.originCount > 0 && input.originVerified === false) {
    return 'origin_mismatch';
  }

  if (input.consentAnalyticsPresent === false) {
    return 'consent_missing';
  }

  if (
    input.scriptVersion &&
    input.liveScriptVersion &&
    input.scriptVersion !== input.liveScriptVersion
  ) {
    return 'script_outdated';
  }

  if (input.originCount > 0 && !input.lastEventAt) {
    return 'installed_no_events';
  }

  if (input.hasIntentCalls) {
    if (input.originVerified === true && input.trafficReceiving === true) {
      return 'conversion_ready';
    }
    return 'intent_events_received';
  }

  if (input.lastEventAt) {
    if (input.lastHeartbeatAt) {
      return 'events_received';
    }
    if (input.lastEventAction && input.lastEventAction !== 'heartbeat') {
      return 'events_received';
    }
    return 'no_heartbeat';
  }

  return 'unknown';
}
