#!/usr/bin/env node
/**
 * PR-9H.7G — Hosted export preview check (markAsExported=false). Safe output only.
 *
 * Requires:
 *   APP_BASE_URL — default https://console.opsmantik.com
 *   PREVIEW_SITE_ID — sites.public_id or sites.id (query siteId=)
 *   PREVIEW_QUEUE_ID — single allowlisted offline_conversion_queue.id
 *   OCI_API_KEY — x-api-key for the site (same as Google Ads Script / opsmantik)
 *
 * Never logs response items (may contain courier fields). Prints counts + diagnostics only.
 *
 * Usage:
 *   PREVIEW_SITE_ID=93cb9966bcf349c1b4ece8ea34142ace PREVIEW_QUEUE_ID=<uuid> node scripts/db/pr9h7g-hosted-preview-check.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const base = String(process.env.APP_BASE_URL || 'https://console.opsmantik.com').replace(/\/$/, '');
const siteId = String(process.env.PREVIEW_SITE_ID || '').trim();
const queueId = String(process.env.PREVIEW_QUEUE_ID || '').trim();
const apiKey = String(process.env.OCI_API_KEY || process.env.CANARY_API_KEY || '').trim();

if (!siteId || !queueId || !apiKey) {
  console.error(
    JSON.stringify({
      ok: false,
      code: 'ENV_MISSING',
      need: ['PREVIEW_SITE_ID', 'PREVIEW_QUEUE_ID', 'OCI_API_KEY (or CANARY_API_KEY)'],
    })
  );
  process.exit(1);
}

const u = new URL(`${base}/api/oci/google-ads-export`);
u.searchParams.set('siteId', siteId);
u.searchParams.set('providerKey', 'google_ads');
u.searchParams.set('markAsExported', 'false');
u.searchParams.set('limit', '1');
u.searchParams.set('canaryMode', 'true');
u.searchParams.set('allowlistIds', queueId);
u.searchParams.set('canaryExpectedQueueId', queueId);

const res = await fetch(u.toString(), {
  headers: {
    'x-api-key': apiKey,
    Accept: 'application/json',
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error(JSON.stringify({ ok: false, code: 'NOT_JSON', http_status: res.status }, null, 2));
  process.exit(1);
}

const items = Array.isArray(body.items) ? body.items : [];
const pd = body.preview_diagnostics || {};
const ac = pd.allowlist_contract || {};
const contractOk =
  ac.applied_to_fetch === true &&
  Number(pd.hashed_phone_exported_count ?? -1) === 1 &&
  Number(pd.hashed_phone_missing_count ?? -1) === 0;

const out = {
  ok: res.ok,
  http_status: res.status,
  policy: 'PR-9H.7G',
  preview_request_redacted: {
    host: u.hostname,
    path: u.pathname,
    markAsExported: false,
    allowlist_single_queue_id: queueId.length === 36,
    item_count: items.length,
    conversion_name_expectation: 'OpsMantik_Won (operator verify item.action in UI if needed)',
  },
  preview_diagnostics_safe: {
    hashed_phone_exported_count: pd.hashed_phone_exported_count ?? null,
    hashed_phone_missing_count: pd.hashed_phone_missing_count ?? null,
    allowlist_contract: {
      applied_to_fetch: ac.applied_to_fetch ?? null,
      parsed_allowlist_count: ac.parsed_allowlist_count ?? null,
      allowlist_query_seen: ac.allowlist_query_seen ?? null,
      allowlist_header_seen: ac.allowlist_header_seen ?? null,
    },
  },
  pr9h7g_gates: {
    item_count_is_1: items.length === 1,
    preview_allowlist_contract_applied_to_fetch: ac.applied_to_fetch === true,
    hashed_phone_exported_count_1: Number(pd.hashed_phone_exported_count) === 1,
    hashed_phone_missing_count_0: Number(pd.hashed_phone_missing_count) === 0,
    all_preview_gates_green: contractOk && items.length === 1 && res.ok,
  },
};

console.log(JSON.stringify(out, null, 2));
process.exit(out.pr9h7g_gates.all_preview_gates_green ? 0 : 2);
