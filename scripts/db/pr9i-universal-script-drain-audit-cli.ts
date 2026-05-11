/**
 * PR-9I — Universal script drain audit (read-only). Classifies QUEUED/RETRY google_ads rows for script-mode sites.
 *
 * Usage:
 *   npx tsx scripts/db/pr9i-universal-script-drain-audit-cli.ts
 *   PR9I_SITE_ID=<uuid|public_id> LIMIT=5000 npx tsx scripts/db/pr9i-universal-script-drain-audit-cli.ts
 *
 * Env:
 *   PR9I_SITE_ID | OPSMANTIK_SITE_ID — optional single-site filter
 *   LIMIT — max rows scanned (default 10000)
 *   PROVIDER_KEY — default google_ads
 *   OUTPUT_JSON — 1 for JSON
 *   DRY_RUN — advisory only (audit never mutates)
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import {
  classifyUniversalDrainRow,
  isExportableUniversalDrainBucket,
  PR9I_SELECTED_IDENTIFIER_POLICY,
  type UniversalDrainAuditBucket,
} from '@/lib/oci/universal-script-drain-audit';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

config({ path: join(process.cwd(), '.env.local'), override: true });

/** Mirrors scripts/release/resolve-target-db-url.mjs — hints only; never prints secrets. */
function redactDbConnectionTarget(input: string | undefined): string {
  if (!input) return 'none';
  try {
    const u = new URL(input);
    const host = u.hostname || 'unknown-host';
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${host}${port}`;
  } catch {
    return 'redacted';
  }
}

function resolveTargetDbConnectionKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const keys = [
    'SUPABASE_DB_POOLER_URL',
    'DATABASE_POOLER_URL',
    'SUPABASE_POOLER_URL',
    'SUPABASE_TRANSACTION_POOLER_URL',
    'SUPABASE_DATABASE_URL',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
  ];
  for (const k of keys) {
    const v = String(env[k] ?? '').trim();
    if (v && !/<|>|example\.com|buraya|redacted/i.test(v)) return k;
  }
  return null;
}

const VALID_BUCKETS: UniversalDrainAuditBucket[] = [
  'EXPORTABLE_GCLID',
  'EXPORTABLE_WBRAID',
  'EXPORTABLE_GBRAID',
  'EXPORTABLE_GCLID_WITH_HASHED_PHONE',
  'EXPORTABLE_WBRAID_WITH_HASHED_PHONE',
  'EXPORTABLE_GBRAID_WITH_HASHED_PHONE',
  'NOT_EXPORTABLE_HASHED_PHONE_ONLY',
  'NOT_EXPORTABLE_NO_IDENTIFIER',
  'NOT_EXPORTABLE_INVALID_VALUE',
  'NOT_EXPORTABLE_INVALID_TIME',
  'NOT_EXPORTABLE_UNSUPPORTED_ACTION',
  'NOT_EXPORTABLE_TERMINAL_OR_NOT_PENDING',
  'NEEDS_REVIEW_MULTIPLE_CLICK_IDS',
];

function uuidSnippet(id: string): string {
  const c = String(id).replace(/-/g, '');
  if (c.length <= 8) return `${c.slice(0, 2)}…`;
  return `${c.slice(0, 4)}…${c.slice(-4)}`;
}

function emptyBucketCounts(): Record<UniversalDrainAuditBucket, number> {
  const o = {} as Record<UniversalDrainAuditBucket, number>;
  for (const b of VALID_BUCKETS) o[b] = 0;
  return o;
}

const QUEUE_SELECT_LIST =
  'id, site_id, status, call_id, gclid, wbraid, gbraid, user_identifiers, conversion_time, occurred_at, value_cents, currency, action, optimization_stage, provider_key, updated_at, created_at';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';
  const limit = Math.max(1, Math.min(100_000, Number(process.env.LIMIT || 10_000) || 10_000));
  const providerKey = String(process.env.PROVIDER_KEY || process.env.OPSMANTIK_PROVIDER_KEY || 'google_ads').trim();
  const siteFilterRaw = String(process.env.PR9I_SITE_ID || process.env.OPSMANTIK_SITE_ID || '').trim();

  const poolerKey = resolveTargetDbConnectionKey(process.env);
  const poolerRaw = poolerKey ? String(process.env[poolerKey] ?? '').trim() : '';
  const poolerHint = poolerKey ? `${poolerKey} → ${redactDbConnectionTarget(poolerRaw)}` : 'none';

  if (!url || !key) {
    console.error(outputJson ? JSON.stringify({ ok: false, code: 'ENV_MISSING' }) : 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const adminClient = createClient(url, key);

  let scriptSiteIds: string[] = [];
  const siteMeta = new Map<string, { public_id: string | null; currency: string | null; timezone: string | null }>();

  if (siteFilterRaw) {
    let resolved;
    try {
      resolved = await resolveSiteIdentity(adminClient, siteFilterRaw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(outputJson ? JSON.stringify({ ok: false, code: 'RESOLVE_ERROR', detail: msg }) : msg);
      process.exit(1);
    }
    if (!resolved.found) {
      console.error(outputJson ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }) : SITE_NOT_FOUND_HINT);
      process.exit(1);
    }
    scriptSiteIds = [resolved.siteUuid];
    const { data: one } = await adminClient
      .from('sites')
      .select('id, public_id, currency, timezone, oci_sync_method')
      .eq('id', resolved.siteUuid)
      .maybeSingle();
    const sync = String((one as { oci_sync_method?: string | null } | null)?.oci_sync_method ?? 'script').trim();
    if (sync === 'api') {
      console.error(
        outputJson
          ? JSON.stringify({ ok: false, code: 'SITE_NOT_SCRIPT_MODE', site_id_tail: uuidSnippet(resolved.siteUuid) })
          : 'Site is oci_sync_method=api — not a script-mode drain candidate.'
      );
      process.exit(1);
    }
    siteMeta.set(resolved.siteUuid, {
      public_id: (one as { public_id?: string | null })?.public_id ?? resolved.publicId ?? null,
      currency: (one as { currency?: string | null })?.currency ?? null,
      timezone: (one as { timezone?: string | null })?.timezone ?? null,
    });
  } else {
    const { data: sites, error: sitesErr } = await adminClient
      .from('sites')
      .select('id, public_id, currency, timezone, oci_sync_method')
      .limit(5000);
    if (sitesErr) {
      console.error(sitesErr.message);
      process.exit(1);
    }
    for (const s of sites || []) {
      const sync = String((s as { oci_sync_method?: string | null }).oci_sync_method ?? 'script').trim();
      if (sync === 'api') continue;
      const id = (s as { id: string }).id;
      scriptSiteIds.push(id);
      siteMeta.set(id, {
        public_id: (s as { public_id?: string | null }).public_id ?? null,
        currency: (s as { currency?: string | null }).currency ?? null,
        timezone: (s as { timezone?: string | null }).timezone ?? null,
      });
    }
  }

  if (scriptSiteIds.length === 0) {
    console.error(outputJson ? JSON.stringify({ ok: false, code: 'NO_SCRIPT_SITES' }) : 'No script-mode sites found.');
    process.exit(1);
  }

  let queueRows: Record<string, unknown>[] = [];
  const q = await adminClient
    .from('offline_conversion_queue')
    .select(QUEUE_SELECT_LIST)
    .in('site_id', scriptSiteIds)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', providerKey)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (q.error) {
    const fallback = await adminClient
      .from('offline_conversion_queue')
      .select(
        'id, site_id, status, call_id, gclid, wbraid, gbraid, conversion_time, occurred_at, value_cents, currency, action, optimization_stage, provider_key, updated_at, created_at'
      )
      .in('site_id', scriptSiteIds)
      .in('status', ['QUEUED', 'RETRY'])
      .eq('provider_key', providerKey)
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (fallback.error) {
      console.error(fallback.error.message);
      process.exit(1);
    }
    queueRows = (fallback.data || []) as Record<string, unknown>[];
  } else {
    queueRows = (q.data || []) as Record<string, unknown>[];
  }

  const callIdsBySite = new Map<string, Set<string>>();
  for (const row of queueRows) {
    const sid = String(row.site_id ?? '');
    const cid = row.call_id != null ? String(row.call_id) : '';
    if (!sid || !cid) continue;
    if (!callIdsBySite.has(sid)) callIdsBySite.set(sid, new Set());
    callIdsBySite.get(sid)!.add(cid);
  }

  const callerHashBySiteCall = new Map<string, string | undefined>();
  const intentCreatedBySiteCall = new Map<string, string | undefined>();

  for (const [siteId, idSet] of callIdsBySite) {
    const ids = [...idSet];
    if (ids.length === 0) continue;
    const { data: calls } = await adminClient
      .from('calls')
      .select('id, caller_phone_hash_sha256, created_at')
      .eq('site_id', siteId)
      .in('id', ids);
    for (const c of calls || []) {
      const id = (c as { id: string }).id;
      const h = (c as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
      const createdAt = (c as { created_at?: string | null }).created_at;
      const key = `${siteId}:${id}`;
      const t = typeof h === 'string' ? h.trim() : '';
      if (t) callerHashBySiteCall.set(key, t);
      if (createdAt) intentCreatedBySiteCall.set(key, createdAt);
    }
  }

  const bucketCounts = emptyBucketCounts();
  const bySite = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const selectedTypeCounts = { gclid: 0, wbraid: 0, gbraid: 0 };
  let hashed_phone_present_count = 0;
  let multiple_click_ids_count = 0;
  let multiple_click_ids_exportable_count = 0;
  let multiple_click_ids_blocked_count = 0;
  let oldestQueuedMs: number | null = null;

  type Example = {
    site_snippet: string;
    queue_snippet: string;
    bucket: UniversalDrainAuditBucket;
    had_gclid: boolean;
    had_wbraid: boolean;
    had_gbraid: boolean;
    hashed_phone_present: boolean;
    multiple_click_ids: boolean;
    action_label: string;
    status: string;
  };
  const examples: Example[] = [];
  /** Full queue UUIDs for operator canary selection only when OUTPUT_JSON=1 (no click ids / no hashes). */
  const exportableGclidWithHashedPhoneRows: Array<{
    queue_id: string;
    action_label: string;
    status: string;
    selected_identifier: 'gclid' | 'wbraid' | 'gbraid';
    had_gclid: boolean;
    had_wbraid: boolean;
    had_gbraid: boolean;
    hashed_phone_present: boolean;
    multiple_click_ids: boolean;
  }> = [];

  for (const raw of queueRows) {
    const row = raw as Record<string, unknown>;
    const siteId = String(row.site_id ?? '');
    const site = siteMeta.get(siteId);
    if (!site) continue;

    const qid = String(row.id ?? '');
    const callId = row.call_id != null ? String(row.call_id) : '';
    const ck = `${siteId}:${callId}`;
    const callerPhoneHashSha256 = callId ? callerHashBySiteCall.get(ck) : undefined;
    const intentCreatedAt = callId ? intentCreatedBySiteCall.get(ck) : undefined;

    const queueRow = row as QueueRow;
    const res = classifyUniversalDrainRow(queueRow, site, {
      callerPhoneHashSha256: callerPhoneHashSha256 ?? null,
      intentCreatedAt: intentCreatedAt ?? null,
      expectPending: true,
      providerKey,
    });

    bucketCounts[res.bucket] += 1;
    bySite.set(siteId, (bySite.get(siteId) ?? 0) + 1);
    const st = String(row.status ?? 'UNKNOWN');
    statusCounts.set(st, (statusCounts.get(st) ?? 0) + 1);
    const actionLabel = String(row.action ?? row.optimization_stage ?? 'UNKNOWN')
      .trim()
      .slice(0, 80);
    actionCounts.set(actionLabel || 'UNKNOWN', (actionCounts.get(actionLabel || 'UNKNOWN') ?? 0) + 1);

    if (res.flags.hashedPhonePresent) hashed_phone_present_count += 1;
    if (res.flags.multipleClickIds) {
      multiple_click_ids_count += 1;
      if (res.selectedType) multiple_click_ids_exportable_count += 1;
      else multiple_click_ids_blocked_count += 1;
    }
    if (res.selectedType === 'gclid') selectedTypeCounts.gclid += 1;
    if (res.selectedType === 'wbraid') selectedTypeCounts.wbraid += 1;
    if (res.selectedType === 'gbraid') selectedTypeCounts.gbraid += 1;

    const upd = row.updated_at != null ? String(row.updated_at) : '';
    if (upd) {
      const ms = Date.parse(upd);
      if (!Number.isNaN(ms)) {
        const age = Date.now() - ms;
        if (oldestQueuedMs === null || age > oldestQueuedMs) oldestQueuedMs = age;
      }
    }

    if (examples.length < 20) {
      examples.push({
        site_snippet: uuidSnippet(siteId),
        queue_snippet: uuidSnippet(qid),
        bucket: res.bucket,
        had_gclid: res.flags.hadGclid,
        had_wbraid: res.flags.hadWbraid,
        had_gbraid: res.flags.hadGbraid,
        hashed_phone_present: res.flags.hashedPhonePresent,
        multiple_click_ids: res.flags.multipleClickIds,
        action_label: actionLabel || 'UNKNOWN',
        status: st,
      });
    }

    if (outputJson && res.bucket === 'EXPORTABLE_GCLID_WITH_HASHED_PHONE' && res.selectedType === 'gclid') {
      if (exportableGclidWithHashedPhoneRows.length < 200 && qid) {
        exportableGclidWithHashedPhoneRows.push({
          queue_id: qid,
          action_label: actionLabel || 'UNKNOWN',
          status: st,
          selected_identifier: 'gclid',
          had_gclid: res.flags.hadGclid,
          had_wbraid: res.flags.hadWbraid,
          had_gbraid: res.flags.hadGbraid,
          hashed_phone_present: res.flags.hashedPhonePresent,
          multiple_click_ids: res.flags.multipleClickIds,
        });
      }
    }
  }

  let exportable_total = 0;
  let not_exportable_total = 0;
  let needs_review_total = 0;
  for (const b of VALID_BUCKETS) {
    const n = bucketCounts[b];
    if (isExportableUniversalDrainBucket(b)) exportable_total += n;
    else if (b === 'NEEDS_REVIEW_MULTIPLE_CLICK_IDS') needs_review_total += n;
    else not_exportable_total += n;
  }

  const ready_universal_script_drain_count = exportable_total;

  const recommended_next_command =
    exportable_total === 0
      ? 'PR9I_AUDIT_READY: fix queue health / identifiers, then re-run audit; hosted preview should show universal_script_exportable_count > 0 before live drain.'
      : 'PR9I_UNIVERSAL_SCRIPT_CANARY_READY: run hosted preview (markAsExported=false), then canary with allowlist=1 + OPSMANTIK_DRAIN_* gates only after dossier checklist.';

  const report = {
    ok: true,
    classifier: 'PR-9I_UNIVERSAL_SCRIPT_DRAIN_AUDIT',
    dry_run: true,
    mutation: 'none',
    provider_key: providerKey,
    selected_identifier_policy: PR9I_SELECTED_IDENTIFIER_POLICY,
    pooler_connection_key_hint: poolerKey,
    pooler_target_redacted: poolerHint,
    total_rows_scanned: queueRows.length,
    script_sites_in_scope: scriptSiteIds.length,
    by_site_counts: Object.fromEntries([...bySite.entries()].map(([k, v]) => [uuidSnippet(k), v])),
    by_status_counts: Object.fromEntries(statusCounts.entries()),
    by_action_counts: Object.fromEntries([...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    bucket_counts: bucketCounts,
    selected_identifier_type_counts: selectedTypeCounts,
    hashed_phone_present_count,
    multiple_click_ids_count,
    multiple_click_ids_exportable_count,
    multiple_click_ids_blocked_count,
    exportable_total,
    not_exportable_total,
    needs_review_total,
    ready_universal_script_drain_count,
    oldest_queued_age_ms: oldestQueuedMs,
    redacted_examples_top: examples,
    ...(outputJson && exportableGclidWithHashedPhoneRows.length > 0
      ? { exportable_gclid_with_hashed_phone_rows: exportableGclidWithHashedPhoneRows }
      : {}),
    recommended_next_command,
    decision_label:
      exportable_total > 0 && needs_review_total === 0 ? 'PR9I_AUDIT_READY' : 'PR9I_AUDIT_REVIEW_REQUIRED',
  };

  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('PR-9I Universal Script Drain Audit (read-only)');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
