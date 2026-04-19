/**
 * Runner provider outcome — record success/failure for the provider circuit
 * breaker. Shared between worker and cron modes.
 *
 * Extracted from lib/oci/runner.ts during Phase 4 god-object split.
 */

import { adminClient } from '@/lib/supabase/admin';
import { logRunnerError } from './log-helpers';

export async function persistProviderOutcome(
  siteId: string,
  providerKey: string,
  isSuccess: boolean,
  isTransient: boolean,
  prefix: string
): Promise<void> {
  try {
    await adminClient.rpc('record_provider_outcome', {
      p_site_id: siteId,
      p_provider_key: providerKey,
      p_is_success: isSuccess,
      p_is_transient: isTransient,
    });
  } catch (e) {
    logRunnerError(prefix, 'record_provider_outcome failed', e);
  }
}
