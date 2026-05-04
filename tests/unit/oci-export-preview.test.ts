/**
 * OCI export: markAsExported=false returns structured response and does not mutate.
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
});

test('google-ads-export route: claim uses RPC not direct update', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('markExportProcessing(auth, built)'), 'claim/update delegated to mark-processing module');
  const markPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts');
  const markSrc = readFileSync(markPath, 'utf8');
  assert.ok(markSrc.includes('append_script_claim_transition_batch'), 'uses actor-owned batch claim RPC');
});

test('google-ads-export route: next_cursor keeps queue and signal streams separate', () => {
  const fetchPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
  const buildPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts');
  const fetchSrc = readFileSync(fetchPath, 'utf8');
  const buildSrc = readFileSync(buildPath, 'utf8');
  assert.ok(buildSrc.includes('q: lastRow ?'), 'queue cursor is encoded independently');
  assert.ok(buildSrc.includes('s: lastSig ?'), 'signal cursor is encoded independently');
  assert.ok(fetchSrc.includes('readExportCursorMark(decoded?.q ?? decoded)'), 'route is backward compatible with legacy cursor');
});

test('google-ads-export route: deterministic skips keep provenance on terminal rows', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(src.includes("last_error: 'SUPPRESSED_BY_HIGHER_GEAR'"), 'highest-only suppression must keep human-readable reason');
  assert.ok(src.includes("provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR'"), 'highest-only suppression must keep explicit provider_error_code');
  assert.ok(src.includes("provider_error_category: 'DETERMINISTIC_SKIP'"), 'suppressed lower gears must stay deterministic skips');
});

test('google-ads-export route: partial claims fail closed before cursor advances', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes("code: 'QUEUE_CLAIM_MISMATCH'"), 'queue claim mismatches must fail closed');
  assert.ok(src.includes("code: 'SIGNAL_CLAIM_MISMATCH'"), 'signal claim mismatches must fail closed');
  const markSrc = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(markSrc.includes('append_script_transition_batch'), 'script terminalization must use DB-owned atomic batch RPC');
});

test('google-ads-export route: signal and pageview orderIds use collision-resistant builder', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  assert.ok(src.includes('buildOrderId('), 'route must use shared orderId builder');
  assert.ok(src.includes('row.external_id || computeOfflineConversionExternalId'), 'seal exports must prefer DB-authoritative external_id');
  assert.ok(src.includes('`signal_${signalId}`') || src.includes("`signal_${signalId}`"), 'signal fallback id must include signal row id');
  assert.ok(!src.includes('`${clickId}_${conversionName}_${conversionTime}`.slice(0, 128)'), 'signal path must not build raw second-level orderId');
  assert.ok(!src.includes('`${clickId}_${OPSMANTIK_CONVERSION_NAMES.satis}_${conversionTime}`.slice(0, 128)'), 'route must not build raw second-level orderId');
});

test('google-ads-export route: pageview pipeline has been removed from export payload', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts'), 'utf8');
  assert.ok(src.includes('pvs: 0'), 'pageview export path should stay disabled');
});

test('google-ads-export route: seals prefer canonical occurred_at over legacy conversion_time', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  assert.ok(src.includes('pickCanonicalOccurredAt(['), 'route must use canonical timestamp picker');
  assert.ok(src.includes('row.occurred_at,'), 'queue export must inspect queue occurred_at first');
  assert.ok(src.includes('row.conversion_time,'), 'route must keep legacy conversion_time only as fallback');
});

test('google-ads-export route: no longer performs V2 recovery before export', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(!src.includes('recoverMissingV2SignalsForSite'), 'route should not attempt V2 recovery');
});

test('google-ads-export route: signal conversion names resolve from canonical stages', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  assert.ok(src.includes('resolveSignalStage('), 'route should map signals to canonical stages');
  assert.ok(src.includes('buildSingleConversionGroupKey'), 'route should create deterministic grouping keys');
  // After Phase 4 f4-runner-split the stage normalizer lives in its own module.
  const normalizerPath = join(process.cwd(), 'lib', 'oci', 'google-ads-export', 'signal-normalizers.ts');
  const normSrc = readFileSync(normalizerPath, 'utf8');
  assert.ok(normSrc.includes("normalizedStage === 'contacted'"), 'normalizer should recognize canonical contacted rows');
  assert.ok(normSrc.includes("normalizedStage === 'offered'"), 'normalizer should recognize canonical offered rows');
  assert.ok(!normSrc.includes("'V3_ENGAGE'"), 'normalizer should no longer normalize V3 aliases');
  assert.ok(!normSrc.includes("'V4_INTENT'"), 'normalizer should no longer normalize V4 aliases');
});

test('google-ads-export route: skips unknown signal stages instead of exporting legacy leftovers', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-signals.ts'), 'utf8');
  assert.ok(src.includes('OCI_EXPORT_SIGNAL_SKIP_UNKNOWN_STAGE'), 'route should log unknown-stage skips explicitly');
  assert.ok(src.includes('if (!stage)'), 'route should block unresolved / unknown signal stages before export');
});

test('google-ads-export route: queue export prefers optimization_value when present', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  void routePath;
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  assert.ok(src.includes('typeof row.optimization_value === \'number\''), 'queue export should inspect optimization_value first');
  assert.ok(src.includes(': minorToMajor(valueGuard.normalized, rowCurrency)'), 'queue export should only fall back to legacy cents when optimization_value is absent');
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
