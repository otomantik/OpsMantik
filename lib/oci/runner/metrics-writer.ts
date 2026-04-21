import { adminClient } from '@/lib/supabase/admin';

export async function writeProviderMetrics(params: {
  siteId: string;
  providerKey: string;
  attempts: number;
  completed: number;
  failed: number;
  retry: number;
}): Promise<void> {
  await adminClient.rpc('increment_provider_upload_metrics', {
    p_site_id: params.siteId,
    p_provider_key: params.providerKey,
    p_attempts_delta: params.attempts,
    p_completed_delta: params.completed,
    p_failed_delta: params.failed,
    p_retry_delta: params.retry,
  });
}
