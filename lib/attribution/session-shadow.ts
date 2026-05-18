import {
  isSourceTruthSsotEnabled,
  resolveSourceTruthForIngest,
  type ResolveSourceTruthInput,
} from './resolve-source-truth';
import type { TrafficClassificationV2 } from './truth-engine-types';

export type SessionShadowInput = ResolveSourceTruthInput;

/** Persist traffic_v2_ledger; when SSOT enabled, caller must use v2 for legacy columns too. */
export async function buildTrafficV2Ledger(
  input: SessionShadowInput
): Promise<TrafficClassificationV2 | null> {
  if (!isSourceTruthSsotEnabled()) return null;
  const resolved = await resolveSourceTruthForIngest({
    site_id: input.site_id,
    session_id: input.session_id,
    url: input.url,
    referrer: input.referrer,
    user_agent: input.user_agent,
    fingerprint: input.fingerprint,
  });
  return resolved.v2;
}
