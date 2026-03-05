/**
 * Phase 20: Forensic Audit Logger
 * Standardized insertion into audit_log for OM-TRACE-UUID chain.
 */

import { adminClient } from '@/lib/supabase/admin';

export type AuditEventStage =
  | 'RECEIVED'
  | 'GEAR_PROCESSED'
  | 'QUEUED_IN_QSTASH'
  | 'SENT_TO_GOOGLE'
  | 'ACK_RECEIVED';

export interface AuditLogEntry {
  trace_id: string;
  event_stage: AuditEventStage;
  payload?: Record<string, unknown> | null;
  error_stack?: string | null;
  site_id?: string | null;
}

/**
 * Insert audit log entry. Fire-and-forget; failures are logged but do not throw.
 */
export async function insertAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await adminClient.from('audit_log').insert({
      trace_id: entry.trace_id,
      event_stage: entry.event_stage,
      payload: entry.payload ?? null,
      error_stack: entry.error_stack ?? null,
      site_id: entry.site_id ?? null,
    });
  } catch (err) {
    console.error('[AuditLogger] insert failed:', err);
  }
}
