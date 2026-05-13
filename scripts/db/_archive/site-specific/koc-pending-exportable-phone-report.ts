/**
 * Koç Oto Kurtarma — pending (QUEUED/RETRY) google_ads rows exportable via universal script lane,
 * split by verified hashed-phone courier present vs absent. Read-only; no click ids or hash hex in output.
 *
 * Usage:
 *   npx tsx scripts/db/_archive/site-specific/koc-pending-exportable-phone-report.ts
 *   OUTPUT_JSON=1 npx tsx scripts/db/_archive/site-specific/koc-pending-exportable-phone-report.ts
 *
 * Env:
 *   OPSMANTIK_SITE_ID | KOC_SITE_ID — sites.public_id or internal UUID (default: Koç public_id)
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import {
  classifyUniversalDrainRow,
  isExportableUniversalDrainBucket,
  PR9I_SELECTED_IDENTIFIER_POLICY,
} from '@/lib/oci/universal-script-drain-audit';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from '../../lib/resolve-site-identity.mjs';

config({ path: join(process.cwd(), '.env.local'), override: true });

const DEFAULT_KOC_PUBLIC_ID = '93cb9966bcf349c1b4ece8ea34142ace';
const PROVIDER = 'google_ads';

type RowOut = {
  queue_id: string;
  status: string;
  action: string | null;
  bucket: string;
  selected_click_type: 'gclid' | 'wbraid' | 'gbraid' | null;
  hashed_phone_courier: 'present' | 'absent';
  multiple_click_ids: boolean;
  value_cents: number;
  currency: string | null;
};

function toQueueRow(raw: Record<string, unknown>): QueueRow & { status?: string } {
  return {
    id: String(raw.id ?? ''),
    status: raw.status != null ? String(raw.status) : undefined,
    sale_id: raw.sale_id != null ? String(raw.sale_id) : null,
    call_id: raw.call_id != null ? String(raw.call_id) : null,
    session_id: raw.session_id != null ? String(raw.session_id) : null,
    gclid: raw.gclid != null ? String(raw.gclid) : null,
    wbraid: raw.wbraid != null ? String(raw.wbraid) : null,
    gbraid: raw.gbraid != null ? String(raw.gbraid) : null,
    user_identifiers: raw.user_identifiers,
    provider_path: raw.provider_path != null ? String(raw.provider_path) : null,
    conversion_time: String(raw.conversion_time ?? ''),
    occurred_at: raw.occurred_at != null ? String(raw.occurred_at) : null,
    created_at: raw.created_at != null ? String(raw.created_at) : null,
    value_cents: Number(raw.value_cents ?? 0),
    optimization_stage: raw.optimization_stage != null ? String(raw.optimization_stage) : null,
    optimization_value: raw.optimization_value != null ? Number(raw.optimization_value) : null,
    currency: raw.currency != null ? String(raw.currency) : null,
    action: raw.action != null ? String(raw.action) : null,
    provider_key: raw.provider_key != null ? String(raw.provider_key) : null,
    external_id: raw.external_id != null ? String(raw.external_id) : null,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';
  const siteRaw = String(process.env.KOC_SITE_ID || process.env.OPSMANTIK_SITE_ID || DEFAULT_KOC_PUBLIC_ID).trim();

  if (!url || !key) {
    console.error(outputJson ? JSON.stringify({ ok: false, code: 'ENV_MISSING' }) : 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(url, key);
  let resolved;
  try {
    resolved = await resolveSiteIdentity(admin, siteRaw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(outputJson ? JSON.stringify({ ok: false, code: 'RESOLVE_ERROR', detail: msg }) : msg);
    process.exit(1);
  }
  if (!resolved.found) {
    console.error(outputJson ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }) : SITE_NOT_FOUND_HINT);
    process.exit(1);
  }

  const siteUuid = resolved.siteUuid;
  const { data: siteRow, error: siteErr } = await admin
    .from('sites')
    .select('currency, timezone')
    .eq('id', siteUuid)
    .maybeSingle();
  if (siteErr || !siteRow) {
    console.error(siteErr?.message ?? 'site row missing');
    process.exit(1);
  }
  const site = {
    currency: (siteRow as { currency?: string | null }).currency ?? null,
    timezone: (siteRow as { timezone?: string | null }).timezone ?? null,
  };

  const { data: rawRows, error: qErr } = await admin
    .from('offline_conversion_queue')
    .select(
      'id, site_id, status, call_id, gclid, wbraid, gbraid, user_identifiers, conversion_time, occurred_at, value_cents, currency, action, optimization_stage, provider_key, updated_at'
    )
    .eq('site_id', siteUuid)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', PROVIDER)
    .order('updated_at', { ascending: true })
    .limit(5000);

  if (qErr) {
    console.error(qErr.message);
    process.exit(1);
  }

  const rows = (rawRows ?? []) as Record<string, unknown>[];
  const callIds = [...new Set(rows.map((r) => (r.call_id ? String(r.call_id) : '')).filter(Boolean))];
  const callerHashByCall = new Map<string, string | undefined>();
  const intentCreatedByCall = new Map<string, string | undefined>();

  const chunk = 200;
  for (let i = 0; i < callIds.length; i += chunk) {
    const slice = callIds.slice(i, i + chunk);
    if (slice.length === 0) continue;
    const { data: calls, error: cErr } = await admin
      .from('calls')
      .select('id, caller_phone_hash_sha256, created_at')
      .eq('site_id', siteUuid)
      .in('id', slice);
    if (cErr) {
      console.error(cErr.message);
      process.exit(1);
    }
    for (const c of calls ?? []) {
      const id = (c as { id: string }).id;
      const h = (c as { caller_phone_hash_sha256?: string | null }).caller_phone_hash_sha256;
      const createdAt = (c as { created_at?: string | null }).created_at;
      const t = typeof h === 'string' ? h.trim() : '';
      if (t) callerHashByCall.set(id, t);
      if (createdAt) intentCreatedByCall.set(id, createdAt);
    }
  }

  const notExportableCounts: Record<string, number> = {};
  const withPhone: RowOut[] = [];
  const withoutPhone: RowOut[] = [];

  for (const raw of rows) {
    const qrow = toQueueRow(raw);
    const callId = qrow.call_id ?? '';
    const ck = callId;
    const callerPhoneHashSha256 = callId ? callerHashByCall.get(callId) : undefined;
    const intentCreatedAt = callId ? intentCreatedByCall.get(callId) : undefined;

    const res = classifyUniversalDrainRow(qrow, site, {
      callerPhoneHashSha256: callerPhoneHashSha256 ?? null,
      intentCreatedAt: intentCreatedAt ?? null,
      expectPending: true,
      providerKey: PROVIDER,
    });

    if (!isExportableUniversalDrainBucket(res.bucket)) {
      notExportableCounts[res.bucket] = (notExportableCounts[res.bucket] ?? 0) + 1;
      continue;
    }

    const courier = res.flags.hashedPhonePresent ? 'present' : 'absent';
    const out: RowOut = {
      queue_id: qrow.id,
      status: String(raw.status ?? ''),
      action: qrow.action ?? null,
      bucket: res.bucket,
      selected_click_type: res.selectedType,
      hashed_phone_courier: courier,
      multiple_click_ids: res.flags.multipleClickIds,
      value_cents: qrow.value_cents,
      currency: qrow.currency ?? null,
    };
    if (courier === 'present') withPhone.push(out);
    else withoutPhone.push(out);
  }

  const report = {
    ok: true,
    classifier: 'KOC_PENDING_EXPORTABLE_PHONE_SPLIT',
    site_id: siteUuid,
    site_public_id: resolved.publicId ?? null,
    provider_key: PROVIDER,
    selected_identifier_policy: PR9I_SELECTED_IDENTIFIER_POLICY,
    pending_rows_scanned: rows.length,
    exportable_total: withPhone.length + withoutPhone.length,
    exportable_with_hashed_phone_courier_count: withPhone.length,
    exportable_without_hashed_phone_courier_count: withoutPhone.length,
    not_exportable_bucket_counts: notExportableCounts,
    exportable_with_phone: withPhone,
    exportable_without_phone: withoutPhone,
  };

  console.log(JSON.stringify(report, outputJson ? null : undefined, outputJson ? 0 : 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
