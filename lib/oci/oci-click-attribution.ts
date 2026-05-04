/**
 * OCI producer–consumer click attribution SSOT.
 * Delegates to getPrimarySource (RPC → session batch → call row) so enqueue matches process-outbox.
 */
import { getPrimarySource, type PrimarySource } from '@/lib/conversation/primary-source';

export type { PrimarySource };

/**
 * Resolve Ads click ids for a call using the same precedence as the outbox worker (`getPrimarySource`).
 */
export async function resolveOciClickAttribution(
  siteId: string,
  input: { callId: string }
): Promise<PrimarySource | null> {
  return getPrimarySource(siteId, { callId: input.callId });
}
