#!/usr/bin/env node
/**
 * PR-9H.7C — Dry-run detector for sweep-time currency drift (queue.currency vs calls.sale_currency).
 *
 * Default: report only. Apply is explicit and guarded (no automatic mutation).
 *
 * Detects rows where:
 * - offline_conversion_queue.entry_reason = sweep_unsent_conversions
 * - q.currency != calls.sale_currency (normalized compare)
 * - calls.sale_currency is a non-empty plausible ISO code
 * - sites.currency matches calls.sale_currency (site agrees with call sale currency)
 *
 * Usage (dry-run):
 *   TARGET_SITE_ID=<uuid_or_public_id> node scripts/db/pr9h7c-currency-anomaly-repair.mjs
 *
 * Apply (explicit):
 *   APPLY=1 APPROVAL_TOKEN=I_APPROVE_OCI_CURRENCY_REPAIR TARGET_SITE_ID=... MAX_ROWS=50 node scripts/db/pr9h7c-currency-anomaly-repair.mjs
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
const apply = process.env.APPLY === '1' || process.env.APPLY === 'true';
const approval = String(process.env.APPROVAL_TOKEN || '').trim();
const requiredApproval = 'I_APPROVE_OCI_CURRENCY_REPAIR';
const maxRows = Math.max(1, Math.min(5000, Number(process.env.MAX_ROWS || 200) || 200));
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';

function normCur(c) {
  return String(c ?? '')
    .trim()
    .toUpperCase();
}

if (!url || !key) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'ENV_MISSING' }) : 'Missing SUPABASE env');
  process.exit(1);
}

const adminClient = createClient(url, key);

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

if (!resolved.found) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }) : SITE_NOT_FOUND_HINT);
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

const { data: siteRow } = await adminClient.from('sites').select('currency').eq('id', siteUuid).maybeSingle();
const siteCurrency = normCur(siteRow?.currency);

const { data: qrows, error: qerr } = await adminClient
  .from('offline_conversion_queue')
  .select('id, currency, call_id, action, status, entry_reason')
  .eq('site_id', siteUuid)
  .eq('entry_reason', 'sweep_unsent_conversions')
  .limit(maxRows * 3);

if (qerr) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'QUEUE_QUERY_FAILED', detail: qerr.message }) : qerr.message);
  process.exit(1);
}

const rows = Array.isArray(qrows) ? qrows : [];
const callIds = [...new Set(rows.map((r) => r.call_id).filter(Boolean))];

/** @type {Record<string, { sale_currency?: string | null }>} */
const callSale = {};
if (callIds.length) {
  const { data: crows, error: cerr } = await adminClient
    .from('calls')
    .select('id, sale_currency')
    .eq('site_id', siteUuid)
    .in('id', callIds);
  if (!cerr && crows) {
    for (const c of crows) {
      if (c?.id) callSale[String(c.id)] = { sale_currency: c.sale_currency ?? null };
    }
  }
}

const anomalies = [];
for (const q of rows) {
  const qc = normCur(q.currency);
  const cid = q.call_id != null ? String(q.call_id) : '';
  const sc = normCur(callSale[cid]?.sale_currency);
  if (!cid || !sc) continue;
  if (qc === sc) continue;
  if (!siteCurrency || siteCurrency !== sc) continue;
  /** sale_currency is valid if 3 letters typical ISO */
  if (sc.length !== 3) continue;
  anomalies.push({
    id: String(q.id),
    action: String(q.action ?? ''),
    status: String(q.status ?? ''),
    old_currency: qc,
    new_currency: sc,
  });
}

const selected = anomalies.slice(0, maxRows);

const byBucket = new Map();
for (const a of selected) {
  const k = `${a.old_currency}->${a.new_currency}|${a.action}|${a.status}`;
  byBucket.set(k, (byBucket.get(k) ?? 0) + 1);
}

const report = {
  ok: true,
  dry_run: !apply,
  site_id: siteUuid,
  site_currency: siteCurrency,
  would_update_count: selected.length,
  by_old_new_action_status: Object.fromEntries([...byBucket.entries()].sort((a, b) => b[1] - a[1])),
  selected_ids: selected.map((a) => a.id),
};

if (apply) {
  if (approval !== requiredApproval) {
    console.error(
      outputJson
        ? JSON.stringify({ ok: false, code: 'APPROVAL_REQUIRED', need: requiredApproval })
        : `Set APPROVAL_TOKEN=${requiredApproval}`
    );
    process.exit(1);
  }
  let updated = 0;
  for (const a of selected) {
    const { error: uerr } = await adminClient
      .from('offline_conversion_queue')
      .update({ currency: a.new_currency })
      .eq('id', a.id)
      .eq('site_id', siteUuid);
    if (!uerr) updated += 1;
  }
  report.applied_update_count = updated;
}

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`PR-9H.7C currency anomaly ${apply ? 'APPLY' : 'dry-run'}`);
  console.log(`site=${siteUuid} would_update=${selected.length} site_currency=${siteCurrency}`);
  console.log(`selected_ids=${selected.map((x) => x.id).join(',')}`);
}
