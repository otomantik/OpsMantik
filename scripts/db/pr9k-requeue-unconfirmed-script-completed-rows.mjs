#!/usr/bin/env node
/**
 * PR-9K — Operator requeue: COMPLETED → RETRY via ledger RPC `requeue_unconfirmed_script_completed_rows_v1`
 * (no direct UPDATE on offline_conversion_queue).
 *
 * Dry-run by default. Apply requires APPLY=1 and PR9K_REQUEUE_APPROVAL token.
 *
 * Usage (dry-run):
 *   PR9K_SITE_ID=... PR9K_SITE_PUBLIC_ID=... PR9K_INCIDENT_KEY=koc-2026-05-01 \\
 *   PR9K_WINDOW_START=... PR9K_WINDOW_END=... OUTPUT_JSON=1 \\
 *   node scripts/db/pr9k-requeue-unconfirmed-script-completed-rows.mjs
 *
 * Apply:
 *   ... APPLY=1 PR9K_REQUEUE_APPROVAL=I_APPROVE_REQUEUE_UNCONFIRMED_GOOGLE_SCRIPT_COMPLETED_ROWS ...
 *
 * Optional: PR9K_QUEUE_IDS=uuid,uuid (subset; default = all eligible from selector RPC)
 * Optional: PR9K_ALLOW_NON_EXPORTABLE_REQUEUE=1
 *
 * Evidence parity (PR-E): apply RPC rejects the same API-strength provider_request_id shapes as the selector.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const APPROVAL = 'I_APPROVE_REQUEUE_UNCONFIRMED_GOOGLE_SCRIPT_COMPLETED_ROWS';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteId = String(process.env.PR9K_SITE_ID || '').trim();
const sitePublicId = String(process.env.PR9K_SITE_PUBLIC_ID || '').trim();
const incidentKey = String(process.env.PR9K_INCIDENT_KEY || '').trim();
const windowStart = String(process.env.PR9K_WINDOW_START || '').trim();
const windowEnd = String(process.env.PR9K_WINDOW_END || '').trim();
const exportRunId = String(process.env.PR9K_EXPORT_RUN_ID || '').trim();
const queueIdsRaw = String(process.env.PR9K_QUEUE_IDS || '').trim();
const includeActionsRaw = String(process.env.PR9K_INCLUDE_ACTIONS || '').trim();
const allowNonExportable = process.env.PR9K_ALLOW_NON_EXPORTABLE_REQUEUE === '1';
const apply = process.env.APPLY === '1' || process.env.APPLY === 'true';
const approval = String(process.env.PR9K_REQUEUE_APPROVAL || '').trim();
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';

function fail(code, detail, extra) {
  const err = { ok: false, code, detail, ...extra };
  console.error(outputJson ? JSON.stringify(err, null, 2) : `${code}: ${detail}`);
  process.exit(1);
}

if (!url || !key) {
  fail('ENV_MISSING', 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (!siteId || !sitePublicId || !incidentKey) {
  fail('PR9K_CONFIG', 'PR9K_SITE_ID, PR9K_SITE_PUBLIC_ID, PR9K_INCIDENT_KEY required');
}

const hasWindow = windowStart.length > 0 && windowEnd.length > 0;
const hasRun = exportRunId.length > 0;
if (!hasRun && !hasWindow) {
  fail('PR9K_WINDOW', 'Set PR9K_EXPORT_RUN_ID or both PR9K_WINDOW_START and PR9K_WINDOW_END');
}

const ws = hasWindow ? new Date(windowStart).toISOString() : null;
const we = hasWindow ? new Date(windowEnd).toISOString() : null;
if (hasWindow && (Number.isNaN(Date.parse(ws)) || Number.isNaN(Date.parse(we)))) {
  fail('PR9K_WINDOW_PARSE', 'PR9K_WINDOW_START / PR9K_WINDOW_END must be valid ISO timestamps');
}

const includeActions =
  includeActionsRaw.length > 0
    ? includeActionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

if (apply && approval !== APPROVAL) {
  fail('PR9K_APPROVAL', 'APPLY=1 requires PR9K_REQUEUE_APPROVAL=' + APPROVAL);
}

const adminClient = createClient(url, key);

const { data: listData, error: listErr } = await adminClient.rpc('pr9k_unconfirmed_script_completed_candidates_v1', {
  p_site_id: siteId,
  p_site_public_id: sitePublicId,
  p_window_start: hasWindow ? ws : null,
  p_window_end: hasWindow ? we : null,
  p_export_run_id: hasRun ? exportRunId : null,
  p_incident_key: incidentKey,
  p_include_actions: includeActions,
});

if (listErr) {
  fail('LIST_RPC_ERROR', listErr.message || String(listErr));
}
if (!listData || listData.ok !== true) {
  fail('LIST_FAILED', 'selector returned non-ok', { listData });
}

const eligibleIds = (listData.candidates || []).map((c) => c.queue_id).filter(Boolean);
let targetIds = eligibleIds;
if (queueIdsRaw.length > 0) {
  const requested = queueIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const eligibleSet = new Set(eligibleIds);
  const ineligible = listData.ineligible_sample || [];
  const nonExportableOk = new Set(
    ineligible.filter((r) => r.exclude_reason === 'not_exportable_no_click_id').map((r) => r.queue_id)
  );
  for (const id of requested) {
    if (!eligibleSet.has(id) && !(allowNonExportable && nonExportableOk.has(id))) {
      fail(
        'PR9K_QUEUE_ID_NOT_ALLOWED',
        `queue_id ${id} is not in eligible set and not allowed as non-exportable`,
        { requested_id: id }
      );
    }
  }
  targetIds = requested;
}

if (targetIds.length === 0) {
  const out = {
    ok: false,
    decision_label: 'PR9K_NO_REQUEUE_CANDIDATES',
    detail: 'zero_target_queue_ids_after_selector',
    list: { counts: listData.counts, decision_label: listData.decision_label },
  };
  console.error(outputJson ? JSON.stringify(out, null, 2) : 'zero_target_queue_ids_after_selector');
  process.exit(1);
}

const { data: dryData, error: dryErr } = await adminClient.rpc('requeue_unconfirmed_script_completed_rows_v1', {
  p_site_id: siteId,
  p_site_public_id: sitePublicId,
  p_window_start: hasWindow ? ws : null,
  p_window_end: hasWindow ? we : null,
  p_export_run_id: hasRun ? exportRunId : null,
  p_queue_ids: targetIds,
  p_incident_key: incidentKey,
  p_allow_non_exportable: allowNonExportable,
  p_apply: false,
});

if (dryErr) {
  fail('REQUEUE_DRY_RPC_ERROR', dryErr.message || String(dryErr));
}
if (!dryData || dryData.ok !== true) {
  fail('REQUEUE_DRY_FAILED', 'dry RPC returned non-ok', { dryData });
}

if (!apply) {
  const out = {
    ok: true,
    apply: false,
    decision_label: dryData.decision_label,
    would_requeue: dryData.would_requeue,
    target_queue_ids: targetIds,
    list_summary: { counts: listData.counts, decision_label: listData.decision_label },
    final_labels: {
      PR9K_REQUEUE_DRY_RUN_READY: true,
      PR9K_SCRIPT_ACK_SEMANTICS_FIXED: null,
    },
  };
  if (outputJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('PR9K_REQUEUE_DRY_RUN_READY would_requeue=', dryData.would_requeue);
    console.log('target_queue_ids', targetIds.join(','));
  }
  process.exit(0);
}

const { data: applyData, error: applyErr } = await adminClient.rpc('requeue_unconfirmed_script_completed_rows_v1', {
  p_site_id: siteId,
  p_site_public_id: sitePublicId,
  p_window_start: hasWindow ? ws : null,
  p_window_end: hasWindow ? we : null,
  p_export_run_id: hasRun ? exportRunId : null,
  p_queue_ids: targetIds,
  p_incident_key: incidentKey,
  p_allow_non_exportable: allowNonExportable,
  p_apply: true,
});

if (applyErr) {
  fail('REQUEUE_APPLY_RPC_ERROR', applyErr.message || String(applyErr));
}
if (!applyData || applyData.ok !== true) {
  fail('REQUEUE_APPLY_FAILED', 'apply RPC returned non-ok', { applyData });
}

const out = {
  ...applyData,
  final_labels: {
    PR9K_REQUEUE_APPLIED: applyData.decision_label === 'PR9K_REQUEUE_APPLIED',
    PR9K_SCRIPT_ACK_SEMANTICS_FIXED: true,
    PR9K_GOOGLE_SCRIPT_PROVIDER_CONFIRMATION_PENDING_GREEN: true,
  },
};
if (outputJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('PR9K_REQUEUE_APPLIED', applyData.transitions_inserted, 'transitions', applyData.audit_rows_inserted, 'audit');
}