#!/usr/bin/env node
/**
 * PR-9H.5B — Google Ads *upload log* visibility vs local queue (read-only).
 *
 * Google Ads “upload log” only shows rows submitted via upload.apply() in the Ads UI.
 * It does NOT list offline_conversion_queue QUEUED rows, PEEK responses, or ACK events.
 *
 * Usage:
 *   TARGET_SITE_ID=<public_id_or_uuid> PROVIDER_KEY=google_ads OUTPUT_JSON=1 node scripts/db/pr9h5b-google-log-visibility-audit.mjs
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
  const err = { ok: false, code: 'ENV_MISSING' };
  console.error(outputJson ? JSON.stringify(err, null, 2) : 'Missing Supabase env');
  process.exit(1);
}

const adminClient = createClient(url, key);

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  console.error(outputJson ? JSON.stringify({ ok: false, detail: String(e) }, null, 2) : String(e));
  process.exit(1);
}

if (!resolved.found) {
  console.error(
    outputJson
      ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }, null, 2)
      : SITE_NOT_FOUND_HINT
  );
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

function hasPart(v) {
  return v != null && String(v).trim() !== '';
}

function clickBucket(row) {
  return `gclid:${hasPart(row.gclid)}_wbraid:${hasPart(row.wbraid)}_gbraid:${hasPart(row.gbraid)}`;
}

try {
  const { data: rows, error } = await adminClient
    .from('offline_conversion_queue')
    .select(
      'id, status, action, call_id, conversion_time, occurred_at, currency, value_cents, gclid, wbraid, gbraid, provider_error_code, provider_error_category, blocked_at, updated_at, created_at'
    )
    .eq('site_id', siteUuid)
    .eq('provider_key', providerKey);

  if (error) throw new Error(error.message);

  const list = Array.isArray(rows) ? rows : [];

  const queuedRetry = list.filter((r) => r.status === 'QUEUED' || r.status === 'RETRY');
  const processing = list.filter((r) => r.status === 'PROCESSING');
  const failed = list.filter((r) => r.status === 'FAILED');

  /** @type {Record<string, Record<string, number>>} */
  const qrByAction = {};
  for (const r of queuedRetry) {
    const a = r.action?.trim() || '(null)';
    qrByAction[a] = qrByAction[a] || {};
    qrByAction[a][r.status] = (qrByAction[a][r.status] || 0) + 1;
  }

  /** @type {Record<string, Record<string, number>>} */
  const clickByAction = {};
  for (const r of queuedRetry) {
    const a = r.action?.trim() || '(null)';
    const b = clickBucket(r);
    clickByAction[a] = clickByAction[a] || {};
    clickByAction[a][b] = (clickByAction[a][b] || 0) + 1;
  }

  const exportFields = {
    queued_retry_total: queuedRetry.length,
    call_id_present: queuedRetry.filter((r) => hasPart(r.call_id)).length,
    call_id_missing: queuedRetry.filter((r) => !hasPart(r.call_id)).length,
    conversion_time_present: queuedRetry.filter((r) => hasPart(r.conversion_time)).length,
    currency_present: queuedRetry.filter((r) => hasPart(r.currency)).length,
    value_cents_positive: queuedRetry.filter((r) => Number(r.value_cents) > 0).length,
    has_gclid_count: queuedRetry.filter((r) => hasPart(r.gclid)).length,
    no_gclid_but_has_brid_count: queuedRetry.filter((r) => !hasPart(r.gclid) && (hasPart(r.wbraid) || hasPart(r.gbraid))).length,
  };

  const now = Date.now();
  const procAge = processing.map((r) => {
    const t = r.updated_at || r.created_at;
    const ms = t ? now - new Date(t).getTime() : 0;
    return { age_hours_rounded: t ? Math.round(ms / 3600000) : null };
  });

  const failedRollupMap = new Map();
  for (const r of failed) {
    const c = r.provider_error_code?.trim() || '(null)';
    const cat = r.provider_error_category?.trim() || '(null)';
    const k = `${c}||${cat}`;
    failedRollupMap.set(k, (failedRollupMap.get(k) || 0) + 1);
  }
  const F_failed_by_provider_error = [...failedRollupMap.entries()]
    .map(([k, cnt]) => {
      const [provider_error_code, provider_error_category] = k.split('||');
      return { provider_error_code, provider_error_category, count: cnt };
    })
    .sort((a, b) => b.count - a.count);

  const report = {
    ok: true,
    code: 'GOOGLE_LOG_VISIBILITY_AUDIT',
    input_site_identifier: resolved.input,
    resolved_site_uuid: siteUuid,
    resolved_public_id: resolved.publicId,
    provider_key: providerKey,
    explanation: {
      google_ads_upload_log:
        'Shows only conversions submitted to Google via Ads Scripts/API upload.apply or equivalent — not local QUEUED rows.',
      peek_export:
        'PEEK (markAsExported=false) returns a preview payload; it does not write to Google upload history.',
      queue_queued:
        'QUEUED/RETRY are export candidates; build pipeline may skip rows (sendability, highest-gear, validation).',
      script_v1_gclid:
        'Production Google Ads Script v1 uploads gclid-only; wbraid/gbraid-only rows are classified unsupported at script — no upload.apply → no Google log line.',
    },
    A_queued_retry_counts_by_action_status: qrByAction,
    B_click_availability_by_action: clickByAction,
    C_export_build_field_readiness_queued_retry: exportFields,
    D_approx_skip_hypothesis:
      'Rows missing call_id, conversion_time, positive value, or failing call sendability / highest-gear dedupe in GET export build will not appear in returned items — hence no script upload / no Google log.',
    E_processing: {
      count: processing.length,
      age_hours_histogram: procAge.reduce((acc, x) => {
        const h = x.age_hours_rounded;
        const k = h == null ? 'unknown' : String(h);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    F_failed_by_provider_error,
    G_ack_and_peek:
      'ACK and ACK_FAILED are server/API accounting — they do not create Google Ads bulk upload log entries.',
  };

  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'QUERY_ERROR', detail: msg }, null, 2) : msg);
  process.exit(1);
}
