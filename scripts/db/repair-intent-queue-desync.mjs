#!/usr/bin/env node

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const DEFAULT_SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';
const ACTIVE_QUEUE_STATUSES = ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED'];
const REPAIR_REASON = 'REPAIRED_INTENT_QUEUE_DESYNC';

function parseArgs(argv) {
  const args = { apply: false, siteId: DEFAULT_SITE_ID };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--site-id') {
      args.siteId = argv[i + 1] || DEFAULT_SITE_ID;
      i += 1;
    }
  }
  return args;
}

function classifyCandidate(callRow) {
  return Number(callRow.lead_score ?? 0) <= 0 ? 'junk' : 'confirm';
}

async function markQueueFailed(siteId, queueRows) {
  const queueIds = queueRows.map((row) => row.id);
  const needsClaim = queueRows.some((row) => ['QUEUED', 'RETRY'].includes(row.status));

  if (needsClaim) {
    const { error: claimError } = await supabase.rpc('append_rpc_claim_transition_batch', {
      p_queue_ids: queueIds,
      p_claimed_at: new Date().toISOString(),
    });

    if (claimError) {
      return claimError;
    }
  }

  const { error } = await supabase.rpc('update_queue_status_locked', {
    p_ids: queueIds,
    p_site_id: siteId,
    p_action: 'MARK_FAILED',
    p_clear_errors: false,
    p_error_code: REPAIR_REASON,
    p_error_category: 'DETERMINISTIC_SKIP',
    p_reason: REPAIR_REASON,
  });

  return error;
}

async function fetchCandidates(siteId) {
  const { data: queueRows, error: queueError } = await supabase
    .from('offline_conversion_queue')
    .select('id, call_id, status, created_at, external_id, value_cents, currency')
    .eq('site_id', siteId)
    .in('status', ACTIVE_QUEUE_STATUSES);

  if (queueError) {
    throw new Error(`Queue okunamadi: ${queueError.message}`);
  }

  const callIds = [...new Set((queueRows || []).map((row) => row.call_id).filter(Boolean))];
  if (!callIds.length) {
    return [];
  }

  const [{ data: callRows, error: callsError }, { data: actionRows, error: actionsError }] = await Promise.all([
    supabase
      .from('calls')
      .select('id, site_id, status, lead_score, caller_phone_hash_sha256, created_at, updated_at')
      .eq('site_id', siteId)
      .in('id', callIds),
    supabase
      .from('call_actions')
      .select('call_id, action_type, created_at')
      .in('call_id', callIds),
  ]);

  if (callsError) {
    throw new Error(`Calls okunamadi: ${callsError.message}`);
  }
  if (actionsError) {
    throw new Error(`Call actions okunamadi: ${actionsError.message}`);
  }

  const callMap = new Map((callRows || []).map((row) => [row.id, row]));
  const actionsByCallId = new Map();
  for (const row of actionRows || []) {
    const list = actionsByCallId.get(row.call_id) || [];
    list.push(row);
    actionsByCallId.set(row.call_id, list);
  }

  const queueByCallId = new Map();
  for (const row of queueRows || []) {
    const list = queueByCallId.get(row.call_id) || [];
    list.push(row);
    queueByCallId.set(row.call_id, list);
  }

  return callIds.flatMap((callId) => {
    const callRow = callMap.get(callId);
    if (!callRow) return [];

    const normalizedStatus = String(callRow.status || '').trim().toLowerCase();
    if (normalizedStatus && normalizedStatus !== 'intent') {
      return [];
    }

    const actionRowsForCall = actionsByCallId.get(callId) || [];
    const hasPersistedAction = actionRowsForCall.some((row) =>
      ['confirm', 'seal', 'junk', 'cancel'].includes(String(row.action_type || '').trim().toLowerCase())
    );
    if (hasPersistedAction) {
      return [];
    }

    const queuedRows = queueByCallId.get(callId) || [];
    if (!queuedRows.length) {
      return [];
    }

    return [{
      call: callRow,
      queueRows: queuedRows,
      existingActions: actionRowsForCall,
      repairAction: classifyCandidate(callRow),
    }];
  });
}

function printReport(siteId, candidates, applyMode) {
  const confirmCount = candidates.filter((item) => item.repairAction === 'confirm').length;
  const junkCount = candidates.filter((item) => item.repairAction === 'junk').length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Intent Queue Desync Repair ${applyMode ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('site_id:', siteId);
  console.log('candidates:', candidates.length);
  console.log('repair_confirm:', confirmCount);
  console.log('repair_junk:', junkCount);
  console.log('');

  if (!candidates.length) {
    console.log('Bozuk aday kayit bulunamadi.');
    return;
  }

  candidates.forEach((item, index) => {
    const queueIds = item.queueRows.map((row) => row.id.slice(0, 8)).join(', ');
    console.log(
      `${index + 1}. call=${item.call.id} | status=${item.call.status ?? 'null'} | lead_score=${item.call.lead_score ?? 'null'} | action=${item.repairAction} | queue=${queueIds}`
    );
  });
  console.log('');
}

async function applyRepair(siteId, candidates) {
  const results = [];

  for (const candidate of candidates) {
    const { call, queueRows, repairAction } = candidate;
    const queueIds = queueRows.map((row) => row.id);
    let queueAlreadyTerminalized = false;
    const payload = {};
    if (call.lead_score !== null && call.lead_score !== undefined) {
      payload.lead_score = Number(call.lead_score);
    }
    if (repairAction === 'confirm') {
      payload.oci_status = 'sealed';
      payload.status = 'repair_confirmed_from_queue';
    }

    const rpcArgs = {
      p_call_id: call.id,
      p_action_type: repairAction === 'confirm' ? 'confirm' : 'junk',
      p_payload: payload,
      p_actor_type: 'system',
      p_actor_id: null,
      p_metadata: {
        source: 'scripts/db/repair-intent-queue-desync.mjs',
        reason: REPAIR_REASON,
        queue_ids: queueIds,
      },
      p_version: null,
    };

    let { data: updated, error: rpcError } = await supabase.rpc('apply_call_action_v1', rpcArgs);

    if (
      rpcError
      && repairAction === 'junk'
      && rpcError.message?.includes('oci_payload_validation_events')
    ) {
      const queueUpdateBeforeRetryError = await markQueueFailed(siteId, queueRows);

      if (queueUpdateBeforeRetryError) {
        results.push({ callId: call.id, ok: false, step: 'queue-prep', error: queueUpdateBeforeRetryError.message });
        continue;
      }

      queueAlreadyTerminalized = true;

      const retryResult = await supabase.rpc('apply_call_action_v1', rpcArgs);
      updated = retryResult.data;
      rpcError = retryResult.error;
    }

    if (rpcError) {
      results.push({ callId: call.id, ok: false, step: 'rpc', error: rpcError.message });
      continue;
    }

    if (!updated) {
      results.push({ callId: call.id, ok: false, step: 'rpc', error: 'RPC no-op' });
      continue;
    }

    if (repairAction === 'junk' && !queueAlreadyTerminalized) {
      const queueUpdateError = await markQueueFailed(siteId, queueRows);

      if (queueUpdateError) {
        results.push({ callId: call.id, ok: false, step: 'queue', error: queueUpdateError.message });
        continue;
      }
    }

    results.push({ callId: call.id, ok: true, action: repairAction });
  }

  return results;
}

async function main() {
  const { apply, siteId } = parseArgs(process.argv.slice(2));
  const candidates = await fetchCandidates(siteId);

  printReport(siteId, candidates, apply);
  if (!apply || !candidates.length) {
    return;
  }

  const results = await applyRepair(siteId, candidates);
  const failed = results.filter((item) => !item.ok);
  const succeeded = results.filter((item) => item.ok);

  console.log('apply_success:', succeeded.length);
  console.log('apply_failed:', failed.length);

  if (failed.length) {
    console.log('');
    console.log('Hatalar:');
    failed.forEach((item) => {
      console.log(`- call=${item.callId} step=${item.step} error=${item.error}`);
    });
    process.exitCode = 1;
  }

  const remaining = await fetchCandidates(siteId);
  console.log('remaining_candidates:', remaining.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
