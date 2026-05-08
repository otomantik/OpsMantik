#!/usr/bin/env node
/**
 * PR-9H.4C — Row-scoped recovery for **fresh** canary row `0b298…` after
 * `PRODUCTION_CANARY_CLAIMED_NOT_UPLOADED` (no Google upload, no ACK).
 *
 * Hard guarantees:
 * - single allowed queue_id / site_id (PR-9H.4B Muratcan fresh canary)
 * - explicit incident approval token
 * - preflight: PROCESSING, uploaded_at null, provider_request_id null
 * - RPC only: `recover_safe_processing_queue_rows_v1`
 * - no direct SQL status update, no delete, no manual terminal success spoofing
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const REQUIRED_APPROVAL = 'I_APPROVE_ROW_SCOPED_RECOVERY_AFTER_CLAIMED_NOT_UPLOADED';
/** PR-9H.4B Muratcan fresh canary — do not generalize without a new guarded script. */
const ALLOWED_QUEUE_ID = '0b298a99-673a-4cd1-a2c1-94a3b192e47c';
const ALLOWED_SITE_ID = '7eb8f5c0-4a96-4a0e-bd89-a463127b26b8';

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
        decision: 'PR9H4C_RECOVERY_BLOCKED',
        reason,
        ...extra,
      },
      null,
      2
    )
  );
  process.exit(1);
}

/** RPC requires stale-age ≥ 1 minute; `0` falls back to `fallback` (default 15). */
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
    blocked('INVALID_APPROVAL_TOKEN', { expected: REQUIRED_APPROVAL });
  }
  if (targetQueueId !== ALLOWED_QUEUE_ID) {
    blocked('INVALID_TARGET_QUEUE_ID', { allowed: ALLOWED_QUEUE_ID });
  }
  if (targetSiteId !== ALLOWED_SITE_ID) {
    blocked('INVALID_TARGET_SITE_ID', { allowed: ALLOWED_SITE_ID });
  }

  const exportRunTag = String(process.env.CANARY_EXPORT_RUN_ID || '').trim();

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    blocked('SUPABASE_ENV_MISSING');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const minAgeMinutes = toInt(process.env.RECOVERY_MIN_AGE_MINUTES, 15);
  const actor = `pr9h4c_claimed_not_uploaded:${operatorId}`.slice(0, 128);
  const reason = `PR9H4C_CLAIMED_NOT_UPLOADED:${incidentTicket}:${incidentOwner}${exportRunTag ? `:${exportRunTag}` : ''}`.slice(
    0,
    256
  );

  const { data: beforeRow, error: beforeError } = await supabase
    .from('offline_conversion_queue')
    .select(
      'id,site_id,status,claimed_at,updated_at,uploaded_at,provider_request_id,external_id,action,value_cents,conversion_time,gclid,wbraid,gbraid'
    )
    .eq('id', targetQueueId)
    .eq('site_id', targetSiteId)
    .maybeSingle();
  if (beforeError) blocked('PRECHECK_READ_FAILED');
  if (!beforeRow) blocked('TARGET_ROW_NOT_FOUND');

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: 'PREFLIGHT_REDACTED_PAYLOAD_SIGNALS',
        queue_id: beforeRow.id,
        conversion_name: beforeRow.action,
        value_cents: beforeRow.value_cents,
        external_id: beforeRow.external_id,
        conversion_time_present: Boolean(beforeRow.conversion_time),
        click_id_type: beforeRow.gclid
          ? 'gclid'
          : beforeRow.wbraid
            ? 'wbraid'
            : beforeRow.gbraid
              ? 'gbraid'
              : 'none',
      },
      null,
      2
    )
  );

  if (beforeRow.status !== 'PROCESSING') {
    blocked('TARGET_ROW_NOT_PROCESSING', { current_status: beforeRow.status });
  }
  if (beforeRow.uploaded_at != null) {
    blocked('UPLOADED_AT_SET_NO_RECOVERY', {});
  }
  if (beforeRow.provider_request_id != null && String(beforeRow.provider_request_id).trim() !== '') {
    blocked('PROVIDER_REQUEST_ID_SET_HOLD', { provider_request_id: 'present' });
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('recover_safe_processing_queue_rows_v1', {
    p_queue_ids: [targetQueueId],
    p_min_age_minutes: minAgeMinutes,
    p_recovery_reason: reason,
    p_actor: actor,
  });
  if (rpcError) blocked('ROW_SCOPED_RECOVERY_RPC_FAILED', { code: rpcError.code, message: rpcError.message });

  const result = Array.isArray(rpcData) ? rpcData[0] || {} : rpcData || {};
  const requested = Number(result.requested_count ?? 0);
  const eligible = Number(result.eligible_count ?? 0);
  const recovered = Number(result.recovered_count ?? 0);
  const skipped = Number(result.skipped_count ?? 0);

  const { data: afterRow, error: afterError } = await supabase
    .from('offline_conversion_queue')
    .select('id,site_id,status,claimed_at,updated_at,external_id,action,uploaded_at,provider_request_id')
    .eq('id', targetQueueId)
    .eq('site_id', targetSiteId)
    .maybeSingle();
  if (afterError || !afterRow) blocked('POSTCHECK_READ_FAILED');

  const payload = {
    ok: true,
    decision:
      requested === 1 && eligible === 1 && recovered === 1 && skipped === 0 ? 'PR9H4C_RECOVERED_TO_RETRY' : 'PR9H4C_PARTIAL_REVIEW_REQUIRED',
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
    note: 'PR-9H.4C deliberately did not call export, markAsExported, upload, ACK, or ACK_FAILED.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  blocked('UNHANDLED_EXCEPTION', {
    message: error instanceof Error ? error.message : String(error),
  });
});
