/**
 * PR-9H.6.1 — Exact-site APPLY: journal intent stages into offline_conversion_queue using
 * enqueueOciConversionRow / enqueueSealConversion (no ACK, no upload, idempotent keys).
 *
 * Env (set by caller / pr9h6-backfill-intents-to-oci-queue.mjs):
 * - TARGET_SITE_ID (required): sites.id UUID or sites.public_id
 * - APPLY=1
 * - I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL=I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL
 * - MAX_ROWS: max enqueue attempts (default 500, cap 5000)
 * - STAGE_ALLOWLIST: comma list: contacted,offered,won,junk_exclusion,junk
 */
import { config } from 'dotenv';
import { resolve as pathResolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { enqueueOciConversionRow } from '@/lib/oci/enqueue-oci-conversion-row';
import { enqueueSealConversion } from '@/lib/oci/enqueue-seal-conversion';
import { INTENT_JOURNAL_STAGES, type IntentJournalStage } from '@/lib/oci/intent-conversion-journal-contract';

config({ path: pathResolve(process.cwd(), '.env.local'), override: true });

const APPROVAL = 'I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL';
const LEGAL_STAGE = new Set<string>(INTENT_JOURNAL_STAGES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSiteIdentity(
  adminClient: SupabaseClient,
  input: string | null | undefined
): Promise<
  | { input: string; found: false }
  | { input: string; found: true; siteUuid: string; publicId: string | null }
> {
  const raw = String(input ?? '').trim();
  if (!raw) return { input: '', found: false };

  const merged = new Map<string, { id: string; public_id: string | null }>();

  const { data: byPublic, error: errPublic } = await adminClient
    .from('sites')
    .select('id, public_id')
    .eq('public_id', raw);
  if (errPublic) throw new Error(`resolveSiteIdentity public_id query failed: ${errPublic.message}`);
  for (const row of byPublic || []) {
    if (row?.id) merged.set(row.id, row);
  }

  if (UUID_RE.test(raw)) {
    const { data: byId, error: errId } = await adminClient.from('sites').select('id, public_id').eq('id', raw);
    if (errId) throw new Error(`resolveSiteIdentity id query failed: ${errId.message}`);
    for (const row of byId || []) {
      if (row?.id) merged.set(row.id, row);
    }
  }

  const rows = [...merged.values()];
  if (rows.length === 0) return { input: raw, found: false };
  if (rows.length > 1) {
    throw new Error(`SITE_IDENTITY_AMBIGUOUS: multiple sites matched input="${raw}".`);
  }

  const only = rows[0];
  return { input: raw, found: true, siteUuid: only.id, publicId: only.public_id ?? null };
}

function normalizeStageAllowlist(raw: string): IntentJournalStage[] {
  const set = new Set<IntentJournalStage>();
  for (const p of raw.split(',')) {
    const t = p.trim().toLowerCase();
    if (!t) continue;
    if (t === 'junk') {
      set.add('junk_exclusion');
      continue;
    }
    if (LEGAL_STAGE.has(t)) set.add(t as IntentJournalStage);
  }
  return [...set];
}

function callMatchesJournalStage(callStatus: string | null | undefined, stage: IntentJournalStage): boolean {
  const s = String(callStatus ?? '').trim().toLowerCase();
  if (stage === 'won') return ['won', 'confirmed', 'qualified', 'real'].includes(s);
  if (stage === 'junk_exclusion') return s === 'junk';
  return s === stage;
}

async function aggregateProviderPaths(
  admin: SupabaseClient,
  siteId: string
): Promise<Record<string, number>> {
  const { data, error } = await admin
    .from('offline_conversion_queue')
    .select('provider_path')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .eq('source_type', 'pr9h6_backfill_queue_apply');
  if (error) return { error_query: 1 };
  const m = new Map<string, number>();
  for (const r of data || []) {
    const pp = ((r as { provider_path?: string }).provider_path ?? '').trim() || '(null)';
    m.set(pp, (m.get(pp) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
  const apply = process.env.APPLY === '1';
  const approved = process.env.I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL === APPROVAL;
  const maxRows = Math.min(5000, Math.max(1, parseInt(String(process.env.MAX_ROWS || '500'), 10) || 500));
  const allowRaw = String(process.env.STAGE_ALLOWLIST || '').trim();

  if (!url || !key) {
    console.log(JSON.stringify({ ok: false, code: 'ENV_MISSING' }, null, 2));
    process.exit(1);
  }
  if (!apply || !approved) {
    console.log(JSON.stringify({ ok: false, code: 'APPLY_OR_APPROVAL_MISSING' }, null, 2));
    process.exit(1);
  }
  if (!allowRaw) {
    console.log(JSON.stringify({ ok: false, code: 'STAGE_ALLOWLIST_REQUIRED' }, null, 2));
    process.exit(1);
  }

  const stages = normalizeStageAllowlist(allowRaw);
  if (!stages.length) {
    console.log(JSON.stringify({ ok: false, code: 'STAGE_ALLOWLIST_EMPTY_AFTER_PARSE' }, null, 2));
    process.exit(1);
  }

  const admin = createClient(url, key);
  const resolved = await resolveSiteIdentity(admin, rawTarget);
  if (!resolved.found) {
    console.log(JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND' }, null, 2));
    process.exit(1);
  }
  const siteUuid = resolved.siteUuid;

  const { data: callRows, error: cErr } = await admin
    .from('calls')
    .select(
      'id, site_id, status, created_at, updated_at, gclid, wbraid, gbraid, lead_score, currency, confirmed_at, sale_amount, sale_occurred_at'
    )
    .eq('site_id', siteUuid)
    .order('updated_at', { ascending: false })
    .limit(Math.min(maxRows * 8, 20000));

  if (cErr) {
    console.log(JSON.stringify({ ok: false, code: 'CALLS_QUERY_FAILED', detail: cErr.message }, null, 2));
    process.exit(1);
  }

  let attempts = 0;
  let created_count = 0;
  let already_exists_count = 0;
  const blocked_count: Record<string, number> = {};
  const skipped_count: Record<string, number> = {};
  const stage_counts: Record<string, number> = {};

  function bumpBlocked(key: string) {
    blocked_count[key] = (blocked_count[key] ?? 0) + 1;
  }
  function bumpSkipped(key: string) {
    skipped_count[key] = (skipped_count[key] ?? 0) + 1;
  }

  outer: for (const row of callRows ?? []) {
    const callId = (row as { id?: string }).id;
    const status = (row as { status?: string | null }).status ?? null;
    if (!callId) continue;

    for (const jStage of stages) {
      if (attempts >= maxRows) break outer;
      if (!callMatchesJournalStage(status, jStage)) continue;

      attempts += 1;
      stage_counts[jStage] = (stage_counts[jStage] ?? 0) + 1;

      const gclid = (row as { gclid?: string | null }).gclid ?? null;
      const wbraid = (row as { wbraid?: string | null }).wbraid ?? null;
      const gbraid = (row as { gbraid?: string | null }).gbraid ?? null;
      const leadScore = Number((row as { lead_score?: number | null }).lead_score ?? 0);
      const currency = String((row as { currency?: string | null }).currency ?? '').trim();
      const updatedAt = (row as { updated_at?: string | null }).updated_at ?? null;
      const createdAt = (row as { created_at?: string | null }).created_at ?? null;
      const signalIso = updatedAt ?? createdAt;
      const signalDate = signalIso ? new Date(signalIso) : new Date();
      const intentCreatedAt = createdAt;

      if (jStage === 'won') {
        const confirmedAt = (row as { confirmed_at?: string | null }).confirmed_at ?? null;
        if (!confirmedAt || !confirmedAt.trim()) {
          bumpSkipped('won_missing_confirmed_at');
          continue;
        }
        const res = await enqueueSealConversion({
          callId,
          siteId: siteUuid,
          confirmedAt: confirmedAt.trim(),
          saleOccurredAt: (row as { sale_occurred_at?: string | null }).sale_occurred_at ?? null,
          saleAmount: (row as { sale_amount?: number | null }).sale_amount ?? null,
          currency,
          leadScore: Number.isFinite(leadScore) ? leadScore : null,
          entryReason: 'pr9h6_backfill_queue_apply',
          journalSourceType: 'pr9h6_backfill_queue_apply',
        });
        if (res.enqueued) created_count += 1;
        else if (res.reason === 'duplicate') already_exists_count += 1;
        else if (res.reason === 'marketing_consent_required') bumpBlocked('CONSENT_MISSING');
        else if (res.reason === 'no_click_id') bumpSkipped('no_click_id'); // Seal still persists blocked row sometimes
        else bumpBlocked(String(res.reason ?? 'enqueue_error'));
        continue;
      }

      const micro = jStage === 'junk_exclusion' ? 'junk' : jStage === 'contacted' ? 'contacted' : 'offered';

      const j = await enqueueOciConversionRow({
        siteId: siteUuid,
        callId,
        stage: micro,
        signalDate,
        intentCreatedAt,
        leadScore: Number.isFinite(leadScore) ? leadScore : 0,
        currency,
        sourceOutboxEventId: null,
        gclid,
        wbraid,
        gbraid,
        journalSourceType: 'pr9h6_backfill_queue_apply',
      });

      if (j.enqueued) created_count += 1;
      else if (j.reason === 'duplicate') already_exists_count += 1;
      else if (j.reason === 'CONSENT_MISSING') bumpBlocked('CONSENT_MISSING');
      else if (j.reason === 'error') bumpBlocked(`error:${String(j.error ?? 'unknown')}`.slice(0, 80));
      else bumpSkipped(String(j.reason ?? 'unknown_micro'));
    }
  }

  const provider_path_counts = await aggregateProviderPaths(admin, siteUuid);

  console.log(
    JSON.stringify(
      {
        ok: true,
        site: { sites_id: siteUuid, public_id: resolved.publicId ?? null, input: resolved.input },
        max_rows_attempt_cap: maxRows,
        attempts,
        stage_allowlist: stages,
        created_count,
        already_exists_count,
        blocked_count,
        skipped_count,
        stage_attempt_counts: stage_counts,
        provider_path_counts_for_backfill_source_type: provider_path_counts,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, code: 'FATAL', detail: String(e) }, null, 2));
  process.exit(1);
});
