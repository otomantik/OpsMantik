import { adminClient } from '@/lib/supabase/admin';

type DeadLetterPipeline = 'SCRIPT' | 'WORKER';
type DeadLetterResourceType = 'oci_queue' | 'marketing_signal';
type DeadLetterErrorCategory = 'PERMANENT' | 'VALIDATION' | 'AUTH' | 'MAX_ATTEMPTS';

export interface DeadLetterAuditEntry {
  siteId: string;
  resourceType: DeadLetterResourceType;
  resourceId: string;
  callId?: string | null;
  traceId?: string | null;
  errorCode: string;
  errorMessage: string;
  errorCategory: DeadLetterErrorCategory;
  attemptCount: number;
  pipeline: DeadLetterPipeline;
}

export async function insertDeadLetterAuditLogs(entries: DeadLetterAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const missingTraceCallIds = [...new Set(
    entries
      .filter((entry) => !entry.traceId && entry.callId)
      .map((entry) => entry.callId as string)
  )];

  const traceIdByCallId = new Map<string, string | null>();
  if (missingTraceCallIds.length > 0) {
    const { data } = await adminClient
      .from('calls')
      .select('id, trace_id')
      .in('id', missingTraceCallIds);

    for (const row of data ?? []) {
      traceIdByCallId.set(
        (row as { id: string }).id,
        ((row as { trace_id?: string | null }).trace_id ?? null)
      );
    }
  }

  const rows = entries.map((entry) => ({
    actor_type: 'service_role' as const,
    action: 'OCI_DEAD_LETTER_QUARANTINE',
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    site_id: entry.siteId,
    payload: {
      trace_id: entry.traceId ?? (entry.callId ? traceIdByCallId.get(entry.callId) ?? null : null),
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
      errorCategory: entry.errorCategory,
      attempt_count: entry.attemptCount,
      pipeline: entry.pipeline,
    },
  }));

  const { error } = await adminClient.from('audit_log').insert(rows);
  if (error) {
    throw error;
  }
}
