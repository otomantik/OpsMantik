#!/usr/bin/env npx tsx
/**
 * Deep intent scan: all calls with status=intent (all time), attribution chain for Google OCI.
 * - Counts test vs prod sites (heuristic).
 * - "google_click": non-empty gclid | wbraid | gbraid on call OR on matched session.
 * - "gclid_strict": at least one non-empty gclid (call or session).
 *
 * Read-only. Uses SUPABASE_SERVICE_ROLE_KEY from .env.local.
 *
 * Usage:
 *   npx tsx scripts/oci/intent-google-attribution-audit.ts
 *   npx tsx scripts/oci/intent-google-attribution-audit.ts --json
 *   npx tsx scripts/oci/intent-google-attribution-audit.ts --list-sendable=50
 *   npx tsx scripts/oci/intent-google-attribution-audit.ts --json
 */
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const PAGE = 800;
const MAX_ROWS = 200_000;

function trimClick(t: string | null | undefined): string {
  return typeof t === 'string' ? t.trim() : '';
}

function hasAnyClick(row: { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }): boolean {
  return Boolean(trimClick(row.gclid) || trimClick(row.wbraid) || trimClick(row.gbraid));
}

function hasGclid(row: { gclid?: string | null }): boolean {
  return Boolean(trimClick(row.gclid));
}

function parseArgs(argv: string[]) {
  const json = argv.includes('--json');
  const fullIds = argv.includes('--full-ids');
  let listSendable = 0;
  for (const a of argv) {
    if (a.startsWith('--list-sendable=')) {
      listSendable = Math.min(500, parseInt(a.slice('--list-sendable='.length), 10) || 0);
    }
  }
  return { json, listSendable, fullIds };
}

type SiteMeta = { id: string; name: string; domain: string | null; public_id: string };

function isTestSite(s: SiteMeta): boolean {
  const pid = (s.public_id || '').toLowerCase();
  const name = (s.name || '').toLowerCase();
  const dom = (s.domain || '').toLowerCase();
  if (pid.startsWith('test_site_')) return true;
  if (name.includes('test site') || name === 'test') return true;
  if (dom.includes('test.opsmantik') || dom.startsWith('test.')) return true;
  return false;
}

type IntentRow = {
  id: string;
  site_id: string;
  created_at: string;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  matched_session_id: string | null;
  session_created_month: string | null;
  source: string | null;
};

async function loadSites(): Promise<Map<string, SiteMeta & { is_test: boolean }>> {
  const { data, error } = await supabase.from('sites').select('id, name, domain, public_id');
  if (error) throw error;
  const m = new Map<string, SiteMeta & { is_test: boolean }>();
  for (const r of data || []) {
    const sm = r as SiteMeta;
    m.set(sm.id, { ...sm, is_test: isTestSite(sm) });
  }
  return m;
}

const SESSION_FETCH_CONCURRENCY = 40;

async function fetchSessionClicks(
  client: SupabaseClient,
  keys: Array<{ site_id: string; session_id: string; month: string }>
): Promise<Map<string, { gclid: string | null; wbraid: string | null; gbraid: string | null }>> {
  const out = new Map<string, { gclid: string | null; wbraid: string | null; gbraid: string | null }>();
  if (keys.length === 0) return out;

  for (let i = 0; i < keys.length; i += SESSION_FETCH_CONCURRENCY) {
    const chunk = keys.slice(i, i + SESSION_FETCH_CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (k) => {
        const { data, error } = await client
          .from('sessions')
          .select('gclid, wbraid, gbraid')
          .eq('site_id', k.site_id)
          .eq('id', k.session_id)
          .eq('created_month', k.month)
          .maybeSingle();
        const key = `${k.site_id}:${k.session_id}:${k.month}`;
        if (error) return { key, row: null as { gclid?: string | null; wbraid?: string | null; gbraid?: string | null } | null };
        return { key, row: data as { gclid?: string | null; wbraid?: string | null; gbraid?: string | null } | null };
      })
    );
    for (const s of settled) {
      if (s.row) out.set(s.key, s.row);
    }
  }
  return out;
}

async function main() {
  const { json, listSendable, fullIds } = parseArgs(process.argv.slice(2));
  const siteMap = await loadSites();

  const prodSendableCallIds: string[] = [];
  const testSendableCallIds: string[] = [];

  let offset = 0;
  let total = 0;

  const summary = {
    generated_at: new Date().toISOString(),
    max_rows_cap: MAX_ROWS,
    page_size: PAGE,
    /** calls.status = intent, all time */
    intents_total: 0,
    intents_test_sites: 0,
    intents_prod_sites: 0,
    /** at least one of gclid|wbraid|gbraid on call row */
    call_row_has_any_click: 0,
    /** resolved after session lookup (call had none, session had some) */
    session_only_any_click: 0,
    /** union: Google-ads-eligible click tuple */
    google_any_click: 0,
    google_gclid_present: 0,
    no_session: 0,
    no_click_anywhere: 0,
    missing_session_join: 0,
  };

  const sendableSamples: Array<{
    call_id: string;
    site_id: string;
    site_name: string;
    is_test: boolean;
    created_at: string;
    google_via: 'call' | 'session';
    gclid_preview: string;
    has_wbraid: boolean;
    has_gbraid: boolean;
  }> = [];

  while (offset < MAX_ROWS) {
    const { data: rows, error } = await supabase
      .from('calls')
      .select(
        'id, site_id, created_at, gclid, wbraid, gbraid, matched_session_id, session_created_month, source'
      )
      .eq('status', 'intent')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    const list = (rows || []) as IntentRow[];
    if (list.length === 0) break;

    const sessionKeys: Array<{ site_id: string; session_id: string; month: string; call_id: string }> = [];
    for (const c of list) {
      if (!c.matched_session_id || !c.session_created_month) continue;
      if (!hasAnyClick(c)) {
        sessionKeys.push({
          site_id: c.site_id,
          session_id: c.matched_session_id,
          month: c.session_created_month,
          call_id: c.id,
        });
      }
    }

    const uniqueKeys = new Map<string, { site_id: string; session_id: string; month: string }>();
    for (const k of sessionKeys) {
      uniqueKeys.set(`${k.site_id}:${k.session_id}:${k.month}`, {
        site_id: k.site_id,
        session_id: k.session_id,
        month: k.month,
      });
    }
    const sessionClicks = await fetchSessionClicks(supabase, [...uniqueKeys.values()]);

    for (const c of list) {
      total += 1;
      summary.intents_total += 1;
      const site = siteMap.get(c.site_id);
      const isTest = site?.is_test ?? false;
      if (isTest) summary.intents_test_sites += 1;
      else summary.intents_prod_sites += 1;

      if (!c.matched_session_id) {
        summary.no_session += 1;
      }

      const callClick = hasAnyClick(c);
      if (callClick) summary.call_row_has_any_click += 1;

      let merged = { gclid: c.gclid, wbraid: c.wbraid, gbraid: c.gbraid };

      if (!callClick && c.matched_session_id && c.session_created_month) {
        const sk = `${c.site_id}:${c.matched_session_id}:${c.session_created_month}`;
        const sRow = sessionClicks.get(sk);
        if (sRow) {
          merged = {
            gclid: sRow.gclid ?? merged.gclid,
            wbraid: sRow.wbraid ?? merged.wbraid,
            gbraid: sRow.gbraid ?? merged.gbraid,
          };
        } else if (uniqueKeys.has(sk)) {
          summary.missing_session_join += 1;
        }
      }

      const googleAny = hasAnyClick(merged);
      const gclidOk = hasGclid(merged);

      if (googleAny) {
        summary.google_any_click += 1;
        if (!callClick) summary.session_only_any_click += 1;
        if (isTest) testSendableCallIds.push(c.id);
        else prodSendableCallIds.push(c.id);
      } else {
        summary.no_click_anywhere += 1;
      }
      if (gclidOk) summary.google_gclid_present += 1;

      if (googleAny && listSendable > 0 && sendableSamples.length < listSendable) {
        const gvia = callClick ? 'call' : 'session';
        const preview = trimClick(merged.gclid).slice(0, 12);
        sendableSamples.push({
          call_id: c.id,
          site_id: c.site_id,
          site_name: site?.name ?? '?',
          is_test: isTest,
          created_at: c.created_at,
          google_via: gvia,
          gclid_preview: preview || '(none — wbraid/gbraid only)',
          has_wbraid: Boolean(trimClick(merged.wbraid)),
          has_gbraid: Boolean(trimClick(merged.gbraid)),
        });
      }
    }

    offset += list.length;
    if (list.length < PAGE) break;
  }

  const out: Record<string, unknown> = { summary, sendableSamples };
  out.prod_sendable_call_ids = prodSendableCallIds;
  out.test_sendable_call_ids = testSendableCallIds;

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('\n=== Intent → Google click attribution audit (status=intent, all time) ===\n');
  console.log(`generated_at: ${summary.generated_at}`);
  console.log(`rows_scanned: ${summary.intents_total} (cap ${MAX_ROWS})\n`);
  console.log('COUNTS');
  console.log(`  intent rows total:        ${summary.intents_total}`);
  console.log(`  on test-flag sites:       ${summary.intents_test_sites}`);
  console.log(`  on prod-flag sites:       ${summary.intents_prod_sites}`);
  console.log(`  call row has any click:   ${summary.call_row_has_any_click}`);
  console.log(`  session-only any click:    ${summary.session_only_any_click} (call empty, session has id)`);
  console.log(`  google any click (union): ${summary.google_any_click}  ← Ads upload eligible (gclid|wbraid|gbraid)`);
  console.log(`  gclid present (call|sess): ${summary.google_gclid_present}`);
  console.log(`  no click anywhere:        ${summary.no_click_anywhere}`);
  console.log(`  no matched_session:      ${summary.no_session}`);
  console.log(`  session fetch miss:       ${summary.missing_session_join} (lookup failures)`);
  console.log('\nTest heuristic: public_id test_site_*, name/site patterns — tune in script if needed.\n');

  if (sendableSamples.length > 0) {
    console.log(`Sample sendable intents (first ${sendableSamples.length}):`);
    console.table(
      sendableSamples.map((s) => ({
        call: s.call_id.slice(0, 8),
        site: s.site_name.slice(0, 24),
        test: s.is_test,
        via: s.google_via,
        gclid_prv: s.gclid_preview,
        wb: s.has_wbraid ? 'y' : '',
        gb: s.has_gbraid ? 'y' : '',
        created: s.created_at.slice(0, 10),
      }))
    );
  }

  console.log('Tests: repo unit tests cover click-id gate (hasAnyClickId) in tests/unit/oci-clickid-gate.test.ts');
  if (fullIds) {
    console.log(`\nprod_sendable_call_ids (${prodSendableCallIds.length}):`);
    console.log(prodSendableCallIds.join('\n'));
    if (testSendableCallIds.length > 0) {
      console.log(`\ntest_sendable_call_ids (${testSendableCallIds.length}):`);
      console.log(testSendableCallIds.join('\n'));
    }
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
