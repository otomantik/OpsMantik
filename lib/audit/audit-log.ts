/**
 * PR-G5: Append-only audit log for billing, admin, and sensitive actions.
 * Call from API routes/cron that use adminClient (service_role). See docs/OPS/AUDIT_LOG_G5.md.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditActorType = 'user' | 'service_role' | 'cron';

export interface AppendAuditLogParams {
  actor_type: AuditActorType;
  actor_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  site_id?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Appends one row to public.audit_log. Must be called with adminClient (service_role).
 * Non-throwing: logs and returns on error so callers are not broken if audit is down.
 */
export async function appendAuditLog(
  client: SupabaseClient,
  params: AppendAuditLogParams
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await client.from('audit_log').insert({
      actor_type: params.actor_type,
      actor_id: params.actor_id ?? null,
      action: params.action,
      resource_type: params.resource_type ?? null,
      resource_id: params.resource_id ?? null,
      site_id: params.site_id ?? null,
      payload: params.payload ?? {},
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
