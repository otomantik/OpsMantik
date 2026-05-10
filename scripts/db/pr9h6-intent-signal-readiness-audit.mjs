#!/usr/bin/env node
/**
 * PR-9H.6 — Read-only intent → OCI queue signal readiness audit.
 *
 * Usage:
 *   TARGET_SITE_ID=<public_id_or_uuid> PROVIDER_KEY=google_ads OUTPUT_JSON=1 node scripts/db/pr9h6-intent-signal-readiness-audit.mjs
 *
 * Never mutates DB. Never prints raw gclid/wbraid/gbraid or PII.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
const providerKey = String(process.env.PROVIDER_KEY || 'google_ads').trim() || 'google_ads';
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';

if (!url || !key) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'ENV_MISSING' }, null, 2) : 'Missing Supabase env');
  process.exit(1);
}

const adminClient = createClient(url, key);

function hasPart(v) {
  return v != null && String(v).trim() !== '';
}

function uidBools(row) {
  const u = row.user_identifiers;
  if (!u || typeof u !== 'object') return { hp: false, he: false };
  return {
    hp: hasPart(u.hashed_phone),
    he: hasPart(u.hashed_email),
  };
}

function scriptV1Ready(row) {
  return hasPart(row.gclid);
}

function apiClickReady(row) {
  return hasPart(row.gclid) || hasPart(row.wbraid) || hasPart(row.gbraid);
}

function ecReady(row) {
  const { hp, he } = uidBools(row);
  return hp || he;
}

function stageFromRow(row) {
  const a = String(row.action || '').trim();
  if (a.includes('Contacted')) return 'contacted';
  if (a.includes('Offered')) return 'offered';
  if (a.includes('Won')) return 'won';
  if (a.includes('Junk')) return 'junk_exclusion';
  const st = String(row.optimization_stage || '').toLowerCase();
  if (['contacted', 'offered', 'won', 'junk'].includes(st)) {
    return st === 'junk' ? 'junk_exclusion' : st;
  }
  return 'unknown';
}

function classifyGap(row) {
  const st = row.status;
  if (st === 'COMPLETED' || st === 'UPLOADED') return 'INTENT_ALREADY_COMPLETED';
  if (st === 'PROCESSING') return 'INTENT_PROCESSING_STUCK';
  if (st === 'FAILED') return 'terminal_failed';
  if (st === 'BLOCKED_PRECEDING_SIGNALS') {
    const br = String(row.block_reason || '');
    if (br.includes('PROVIDER_PATH_SCRIPT_V1')) return 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED';
    if (br === 'MISSING_CLICK_ID' && ecReady(row)) return 'ENHANCED_SIGNAL_AVAILABLE_BUT_NOT_USED';
    if (br === 'NOT_SENDABLE') return 'INTENT_BLOCKED_BY_SENDABILITY';
    if (br.includes('MISSING')) return 'INTENT_BLOCKED_BY_CLICK_ID';
    return 'INTENT_JOURNALIZED_NOT_EXPORT_ELIGIBLE';
  }
  if (st === 'QUEUED' || st === 'RETRY') {
    if (!apiClickReady(row) && !ecReady(row)) return 'INTENT_BLOCKED_BY_CLICK_ID';
    if (!scriptV1Ready(row) && apiClickReady(row)) return 'WBRAID_GBRAID_AVAILABLE_BUT_SCRIPT_UNSUPPORTED';
  }
  return 'UNKNOWN_GAP';
}

async function safeCount(table, siteColumn, siteUuid, extra = () => {}) {
  let q = adminClient.from(table).select('*', { count: 'exact', head: true }).eq(siteColumn, siteUuid);
  extra(q);
  const { count, error } = await q;
  if (error) return { ok: false, error: error.message, count: null };
  return { ok: true, count: count ?? 0, error: null };
}

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  console.error(outputJson ? JSON.stringify({ ok: false, detail: String(e) }, null, 2) : String(e));
  process.exit(1);
}

if (!resolved.found) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }, null, 2) : SITE_NOT_FOUND_HINT);
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

try {
  const { data: rows, error: qErr } = await adminClient
    .from('offline_conversion_queue')
    .select(
      'id, status, action, call_id, session_id, sale_id, provider_path, block_reason, provider_error_code, provider_error_category, optimization_stage, gclid, wbraid, gbraid, user_identifiers, external_id, created_at, updated_at'
    )
    .eq('site_id', siteUuid)
    .eq('provider_key', providerKey);

  if (qErr) throw new Error(qErr.message);

  const list = Array.isArray(rows) ? rows : [];

  const byStage = {};
  const byStatus = {};
  const byAction = {};
  const signal = {
    has_gclid: 0,
    has_wbraid: 0,
    has_gbraid: 0,
    has_hashed_phone: 0,
    has_hashed_email: 0,
    has_external_id: 0,
  };
  let scriptV1Ready = 0;
  let scriptV1NotReady = 0;
  let apiClick = 0;
  let ec = 0;
  const gapTally = {};

  for (const r of list) {
    const stg = stageFromRow(r);
    byStage[stg] = (byStage[stg] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const act = r.action?.trim() || '(null)';
    byAction[act] = (byAction[act] || 0) + 1;

    if (hasPart(r.gclid)) signal.has_gclid += 1;
    if (hasPart(r.wbraid)) signal.has_wbraid += 1;
    if (hasPart(r.gbraid)) signal.has_gbraid += 1;
    const ub = uidBools(r);
    if (ub.hp) signal.has_hashed_phone += 1;
    if (ub.he) signal.has_hashed_email += 1;
    if (hasPart(r.external_id)) signal.has_external_id += 1;

    if (scriptV1Ready(r)) scriptV1Ready += 1;
    else scriptV1NotReady += 1;
    if (apiClickReady(r)) apiClick += 1;
    if (ecReady(r)) ec += 1;

    const g = classifyGap(r);
    gapTally[g] = (gapTally[g] || 0) + 1;
  }

  const ms = await safeCount('marketing_signals', 'site_id', siteUuid);
  const calls = await safeCount('calls', 'site_id', siteUuid);

  const report = {
    ok: true,
    pr: 'PR-9H.6',
    site: { input: resolved.input, sites_id: siteUuid, public_id: resolved.publicId },
    provider_key: providerKey,
    A_intent_stage_counts: byStage,
    B_queue_status_counts: byStatus,
    C_action_counts: byAction,
    D_signal_availability: signal,
    E_provider_readiness: {
      script_v1_gclid_ready: scriptV1Ready,
      script_v1_gclid_not_ready: scriptV1NotReady,
      api_click_id_ready_rows: apiClick,
      enhanced_conversions_leads_signal_rows: ec,
    },
    F_gap_classifications: gapTally,
    G_source_table_counts: {
      marketing_signals_site_rows: ms.ok ? ms.count : null,
      marketing_signals_error: ms.ok ? null : ms.error,
      calls_site_rows: calls.ok ? calls.count : null,
      calls_error: calls.ok ? null : calls.error,
    },
    notes: {
      marketing_signals_audit_only: 'marketing_signals is not Google upload authority; offline_conversion_queue is SSOT.',
      no_raw_click_ids: 'This report uses booleans/counts only.',
    },
  };

  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(outputJson ? JSON.stringify({ ok: false, detail: String(e) }, null, 2) : String(e));
  process.exit(1);
}
