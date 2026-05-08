#!/usr/bin/env node
/**
 * PR-9F guarded row-scoped recovery for canary incident row.
 *
 * Hard guarantees:
 * - requires explicit incident approval metadata
 * - targets exactly one queue_id/site_id
 * - calls only recover_safe_processing_queue_rows_v1
 * - no direct SQL status update
 * - no delete
 * - no COMPLETED mutation
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const REQUIRED_APPROVAL = 'I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_PROCESS_VIOLATION';
const REQUIRED_QUEUE_ID = '6c1537a7-98ca-47eb-8bd9-67c35965cf9d';
const REQUIRED_SITE_ID = '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8';

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`MISSING_ENV:${name}`);
  }
  return value;
}

function blocked(reason, extra = {}) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        decision: 'INCIDENT_RECOVERY_BLOCKED',
        reason,
        ...extra,
      },
      null,
      2
    )
  );
  process.exit(1);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  let incidentTicket;
  let operatorId;
  let incidentOwner;
  let approval;
  let targetQueueId;
  let targetSiteId;
  try {
    incidentTicket = getRequiredEnv('INCIDENT_TICKET');
    operatorId = getRequiredEnv('OPERATOR_ID');
    incidentOwner = getRequiredEnv('INCIDENT_OWNER');
    approval = getRequiredEnv('CANARY_INCIDENT_RECOVERY_APPROVAL');
    targetQueueId = getRequiredEnv('RECOVERY_TARGET_QUEUE_ID');
    targetSiteId = getRequiredEnv('RECOVERY_TARGET_SITE_ID');
  } catch (error) {
    const missing = String(error instanceof Error ? error.message : error);
    blocked('APPROVAL_ENV_MISSING', { missing });
  }

  if (approval !== REQUIRED_APPROVAL) {
    blocked('INVALID_APPROVAL_TOKEN');
  }
  if (targetQueueId !== REQUIRED_QUEUE_ID) {
    blocked('INVALID_TARGET_QUEUE_ID');
  }
  if (targetSiteId !== REQUIRED_SITE_ID) {
    blocked('INVALID_TARGET_SITE_ID');
  }

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    blocked('SUPABASE_ENV_MISSING');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const minAgeMinutes = toInt(process.env.RECOVERY_MIN_AGE_MINUTES, 15);
  const actor = `canary_incident_recovery:${operatorId}`.slice(0, 128);
  const reason = `CANARY_INCIDENT_ROW_SCOPED_RECOVERY:${incidentTicket}:${incidentOwner}`.slice(0, 256);

  const { data: beforeRow, error: beforeError } = await supabase
    .from('offline_conversion_queue')
    .select('id,site_id,status,claimed_at,updated_at,external_id,action')
    .eq('id', targetQueueId)
    .eq('site_id', targetSiteId)
    .maybeSingle();
  if (beforeError) blocked('PRECHECK_READ_FAILED');
  if (!beforeRow) blocked('TARGET_ROW_NOT_FOUND');
  if (beforeRow.status !== 'PROCESSING') {
    blocked('TARGET_ROW_NOT_PROCESSING', { current_status: beforeRow.status });
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('recover_safe_processing_queue_rows_v1', {
    p_queue_ids: [targetQueueId],
    p_min_age_minutes: minAgeMinutes,
    p_recovery_reason: reason,
    p_actor: actor,
  });
  if (rpcError) blocked('ROW_SCOPED_RECOVERY_RPC_FAILED');

  const result = Array.isArray(rpcData) ? rpcData[0] || {} : rpcData || {};
  const requested = Number(result.requested_count ?? 0);
  const eligible = Number(result.eligible_count ?? 0);
  const recovered = Number(result.recovered_count ?? 0);
  const skipped = Number(result.skipped_count ?? 0);

  const { data: afterRow, error: afterError } = await supabase
    .from('offline_conversion_queue')
    .select('id,site_id,status,claimed_at,updated_at,external_id,action')
    .eq('id', targetQueueId)
    .eq('site_id', targetSiteId)
    .maybeSingle();
  if (afterError || !afterRow) blocked('POSTCHECK_READ_FAILED');

  const payload = {
    ok: true,
    decision:
      requested === 1 && eligible === 1 && recovered === 1 && skipped === 0
        ? 'INCIDENT_ROW_RECOVERED_TO_RETRY'
        : 'INCIDENT_RECOVERY_PARTIAL_REVIEW_REQUIRED',
    counters: {
      requested_count: requested,
      eligible_count: eligible,
      recovered_count: recovered,
      skipped_count: skipped,
    },
    row: {
      queue_id: targetQueueId,
      before_status: beforeRow.status,
      after_status: afterRow.status,
      external_id_unchanged: beforeRow.external_id === afterRow.external_id,
      conversion_name_unchanged: beforeRow.action === afterRow.action,
    },
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  blocked('UNHANDLED_EXCEPTION', {
    message: error instanceof Error ? error.message : String(error),
  });
});
