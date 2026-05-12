/**
 * OCI export: markAsExported=false returns structured response and does not mutate.
 * Journal-only: `offline_conversion_queue` is the sole Google batch source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('google-ads-export route: markAsExported returns { items, next_cursor } for script', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('responseData') && src.includes('next_cursor'), 'script gets items and next_cursor');
  assert.ok(src.includes('buildExportResponseAsync'), 'response formatting delegated');
});

test('google-ads-export route: markAsExported false returns structured preview', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('siteId: auth.siteUuid'), 'preview has siteId');
  assert.ok(src.includes('items: built.combined'), 'preview has items');
  assert.ok(src.includes('counts:'), 'preview has counts');
  assert.ok(src.includes('warnings:'), 'preview has warnings');
  assert.ok(
    src.includes('if (!auth.markAsExported && previewExtension)'),
    'preview diagnostics must only be emitted for read-only preview mode'
  );
  assert.ok(src.includes('preview_diagnostics'), 'preview response must expose diagnostics payload');
  assert.ok(src.includes('fetched_count') && src.includes('skip_reason_counts'), 'preview diagnostics should include stage and reason counters');
});

test('google-ads-export route: claim uses RPC not direct update', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('markExportProcessing(auth, built)'), 'claim/update delegated to mark-processing module');
  const markPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
  const markSrc = readFileSync(markPath, 'utf8');
  assert.ok(markSrc.includes('append_script_claim_transition_batch'), 'uses actor-owned batch claim RPC');
  assert.ok(markSrc.includes('if (!ctx.markAsExported) return;'), 'preview mode must not claim queue rows');
});

test('google-ads-export: skip reasons are surfaced for preview investigations', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('call_not_sendable'), 'preview diagnostics should count call sendability drops');
  assert.ok(src.includes('invalid_conversion_time'), 'preview diagnostics should count invalid time drops');
  assert.ok(src.includes('invalid_value'), 'preview diagnostics should count invalid value drops');
  assert.ok(src.includes('suppressed_by_higher_gear'), 'preview diagnostics should count higher-gear suppressions');
});

test('junk exclusion stays canonical and intentionally export-path visible', () => {
  const namesPath = join(process.cwd(), 'lib', 'oci', 'conversion-names.ts');
  const queueBuildPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts');
  const namesSrc = readFileSync(namesPath, 'utf8');
  const queueBuildSrc = readFileSync(queueBuildPath, 'utf8');
  assert.ok(namesSrc.includes("junk: 'OpsMantik_Junk_Exclusion'"), 'junk exclusion must remain in canonical conversion names');
  assert.ok(queueBuildSrc.includes('conversionName =') && queueBuildSrc.includes('row.action'), 'build path should carry queue action as conversionName');
});

test('google-ads-export: fetch has no marketing_signals batch', () => {
  const fetchPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
  const fetchSrc = readFileSync(fetchPath, 'utf8');
  assert.ok(!fetchSrc.includes("from('marketing_signals')"), 'export fetch must not query marketing_signals');
  assert.ok(
    fetchSrc.includes('fetch_oci_google_ads_export_jit_v1') && fetchSrc.includes('parseJitExportRpcRowsStrict'),
    'export fetch reads journal via JIT RPC + Zod'
  );
});

test('google-ads-export: cursor is journal-only (q stream)', () => {
  const fetchPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
  const buildPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts');
  const fetchSrc = readFileSync(fetchPath, 'utf8');
  const buildSrc = readFileSync(buildPath, 'utf8');
  assert.ok(
    fetchSrc.includes('decoded?.q') ||
      buildSrc.includes('decoded?.q') ||
      buildSrc.includes('"q":') ||
      buildSrc.includes("'q':") ||
      buildSrc.includes('JSON.stringify({') ||
      buildSrc.includes('q: { t:'),
    'next cursor encodes queue position'
  );
  assert.ok(!fetchSrc.includes('signalCursor') && !fetchSrc.includes('signalCursorUpdatedAt'), 'auth must not track signal pagination');
  assert.ok(!buildSrc.includes('lastSig'), 'build-items must not encode legacy signal cursor');
});

test('google-ads-export route: deterministic skips keep provenance on terminal rows', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(
    src.includes("'SUPPRESSED_BY_HIGHER_GEAR'") && src.includes('claimAndFinalizeQueue'),
    'highest-only suppression must terminalize via shared finalizer with explicit provenance code'
  );
  assert.ok(src.includes('provider_error_category: \'DETERMINISTIC_SKIP\''), 'suppressed rows must stay deterministic skips');
});

test('google-ads-export route: partial queue claims fail closed before cursor advances', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes("code: 'QUEUE_CLAIM_MISMATCH'"), 'queue claim mismatches must fail closed');
  const markSrc = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(markSrc.includes('append_script_transition_batch'), 'script terminalization must use DB-owned atomic batch RPC');
});

test('google-ads-export auth: canary mode enforces metadata before live claim', () => {
  const authPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
  const src = readFileSync(authPath, 'utf8');
  assert.ok(src.includes('x-opsmantik-change-ticket'), 'canary mode must require change ticket header');
  assert.ok(src.includes('x-opsmantik-operator-id'), 'canary mode must require operator header');
  assert.ok(src.includes('x-opsmantik-canary-approval'), 'canary mode must require canary approval header');
  assert.ok(src.includes('x-opsmantik-canary-expected-queue-id'), 'canary mode must carry expected queue id');
  assert.ok(src.includes('CANARY_EXPORT_BLOCKED'), 'missing canary metadata must block live claim');
});

test('google-ads-export: queue export uses collision-resistant orderId / external_id', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts'), 'utf8');
  assert.ok(src.includes('buildOrderId('), 'queue export must use shared orderId builder');
  assert.ok(src.includes('row.external_id || computeOfflineConversionExternalId'), 'exports must prefer DB-authoritative external_id');
});

test('google-ads-export route: pageview pipeline has been removed from export payload', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('pvs: 0'), 'pageview export path should stay disabled');
});

test('google-ads-export: seals prefer canonical occurred_at over legacy conversion_time (build-queue)', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts'), 'utf8');
  assert.ok(src.includes('pickCanonicalOccurredAt(['), 'must use canonical timestamp picker');
  assert.ok(src.includes('row.occurred_at'), 'queue export must inspect occurred_at');
  assert.ok(src.includes('row.conversion_time'), 'legacy conversion_time remains fallback');
  assert.ok(!src.includes('row.created_at'), 'queue export must not fall back to row.created_at for conversion time');
});

test('google-ads-export route: no longer performs V2 recovery before export', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(!src.includes('recoverMissingV2SignalsForSite'), 'route should not attempt V2 recovery');
});

test('signal-normalizers: canonical stage aliases for non-export consumers', () => {
  const normalizerPath = join(process.cwd(), 'lib', 'oci', 'google-ads-export', 'signal-normalizers.ts');
  const normSrc = readFileSync(normalizerPath, 'utf8');
  assert.ok(normSrc.includes("normalizedStage === 'contacted'"), 'normalizer should recognize canonical contacted rows');
  assert.ok(normSrc.includes("normalizedStage === 'offered'"), 'normalizer should recognize canonical offered rows');
  assert.ok(!normSrc.includes("'V3_ENGAGE'"), 'normalizer should no longer normalize V3 aliases');
  assert.ok(!normSrc.includes("'V4_INTENT'"), 'normalizer should no longer normalize V4 aliases');
});

test('google-ads-export: queue export is DB-cents authoritative', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-queue.ts'), 'utf8');
  assert.ok(!src.includes("typeof row.optimization_value === 'number'"), 'queue export must not prioritize optimization_value');
  assert.ok(src.includes('minorToMajor(valueGuard.normalized, resolvedCurrency)'), 'queue export should derive major value directly from value_cents');
});

test('claim RPC migration: increments attempt_count', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261113000000_outbox_events_table_claim_finalize.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('attempt_count + 1') || src.includes('o.attempt_count + 1'), 'claim RPC increments attempt_count');
});

test('legacy OCI export routes have been deleted', () => {
  const exportPath = join(process.cwd(), 'app', 'api', 'oci', 'export', 'route.ts');
  const exportBatchPath = join(process.cwd(), 'app', 'api', 'oci', 'export-batch', 'route.ts');
  assert.ok(!existsSync(exportPath), 'legacy /api/oci/export must be deleted');
  assert.ok(!existsSync(exportBatchPath), 'legacy /api/oci/export-batch must be deleted');
});
