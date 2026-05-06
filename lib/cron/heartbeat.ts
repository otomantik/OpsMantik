import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';

export type CronHeartbeatStatus = 'RUNNING' | 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';

interface CronHeartbeatPayload {
  jobName: string;
  routePath: string;
  status: CronHeartbeatStatus;
  schedulerType?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  rowsAffected?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function recordCronHeartbeat(payload: CronHeartbeatPayload): Promise<void> {
  try {
    await adminClient.rpc('upsert_cron_job_heartbeat', {
      p_job_name: payload.jobName,
      p_scheduler_type: payload.schedulerType ?? 'vercel_cron',
      p_route_path: payload.routePath,
      p_status: payload.status,
      p_started_at: payload.startedAt ?? null,
      p_finished_at: payload.finishedAt ?? null,
      p_duration_ms: payload.durationMs ?? null,
      p_rows_affected: payload.rowsAffected ?? null,
      p_error_code: payload.errorCode ?? null,
      p_error_message: payload.errorMessage ?? null,
    });
  } catch (err) {
    logWarn('CRON_HEARTBEAT_WRITE_FAILED', {
      job_name: payload.jobName,
      route_path: payload.routePath,
      status: payload.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
