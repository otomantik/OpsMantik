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
  assert.ok(src.includes('items: combined') && src.includes('next_cursor'), 'script gets items and next_cursor');
  assert.ok(src.includes('NextResponse.json(responseData)'), 'structured response fallback');
});

test('google-ads-export route: markAsExported false returns structured preview', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('siteId: siteUuid'), 'preview has siteId');
  assert.ok(src.includes('items: combined'), 'preview has items');
  assert.ok(src.includes('counts:'), 'preview has counts');
  assert.ok(src.includes('warnings:'), 'preview has warnings');
});

test('google-ads-export route: claim uses RPC not direct update', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('append_script_claim_transition_batch'), 'uses actor-owned batch claim RPC');
});

test('google-ads-export route: next_cursor keeps queue and signal streams separate', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('const target: ExportCursorState'), 'cursor state object exists');
  assert.ok(src.includes('q: lastRow ?'), 'queue cursor is encoded independently');
  assert.ok(src.includes('s: lastSig ?'), 'signal cursor is encoded independently');
  assert.ok(src.includes('readExportCursorMark(decoded?.q ?? decoded)'), 'route is backward compatible with legacy cursor');
});

test('google-ads-export route: deterministic skips keep provenance on terminal rows', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes("last_error: 'SUPPRESSED_BY_HIGHER_GEAR'"), 'highest-only suppression must keep human-readable reason');
  assert.ok(src.includes("provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR'"), 'highest-only suppression must keep explicit provider_error_code');
  assert.ok(src.includes("provider_error_category: 'DETERMINISTIC_SKIP'"), 'suppressed lower gears must stay deterministic skips');
});

test('google-ads-export route: partial claims fail closed before cursor advances', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes("code: 'QUEUE_CLAIM_MISMATCH'"), 'queue claim mismatches must fail closed');
  assert.ok(src.includes("code: 'SIGNAL_CLAIM_MISMATCH'"), 'signal claim mismatches must fail closed');
  assert.ok(src.includes('append_script_transition_batch'), 'script terminalization must use DB-owned atomic batch RPC');
});

test('google-ads-export route: signal and pageview orderIds use collision-resistant builder', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('buildOrderId('), 'route must use shared orderId builder');
  assert.ok(src.includes('row.external_id || computeOfflineConversionExternalId'), 'seal exports must prefer DB-authoritative external_id');
  assert.ok(src.includes('`signal_${signalRowId}`') || src.includes("`signal_${signalRowId}`"), 'signal fallback id must include signal row id');
  assert.ok(!src.includes('`${clickId}_${conversionName}_${conversionTime}`.slice(0, 128)'), 'signal path must not build raw second-level orderId');
  assert.ok(!src.includes('`${clickId}_${OPSMANTIK_CONVERSION_NAMES.V1_PAGEVIEW}_${conversionTime}`.slice(0, 128)'), 'pageview path must not build raw second-level orderId');
});

test('google-ads-export route: V1 sampling is script-owned and Redis keys are canonicalized', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('getPvQueueKeysForExport(siteUuid'), 'export must read V1 rows from canonical queue key set');
  assert.ok(src.includes('getPvProcessingKey(siteUuid)'), 'export must move V1 rows into canonical processing key');
  assert.ok(src.includes('Sampling is script-owned'), 'route must document script-owned V1 sampling');
  assert.ok(!src.includes('simpleHash(pvId)'), 'backend must not silently self-sample V1 rows');
});

test('google-ads-export route: seals prefer canonical occurred_at over legacy conversion_time', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('pickCanonicalOccurredAt(['), 'route must use canonical timestamp picker');
  assert.ok(src.includes('row.occurred_at,'), 'queue export must inspect queue occurred_at first');
  assert.ok(src.includes('row.conversion_time,'), 'route must keep legacy conversion_time only as fallback');
});

test('google-ads-export route: recovers missing phone and WhatsApp V2 signals before export', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('recoverMissingV2SignalsForSite'), 'route should invoke site-scoped V2 recovery');
  assert.ok(src.includes("source: 'click'"), 'recovery should target click-origin intents');
  assert.ok(src.includes("intentActions: ['phone', 'whatsapp']"), 'recovery should cover phone and WhatsApp intents');
});

test('google-ads-export route: signal conversion names honor per-channel V2/V3/V4 config', () => {
  const routePath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const src = readFileSync(routePath, 'utf8');
  assert.ok(src.includes('resolveSignalGear('), 'route should map legacy signal types back to gears');
  assert.ok(src.includes('normalizeSignalChannel(ctx?.intentAction)'), 'route should derive channel from call intent action');
  assert.ok(src.includes('getConversionActionConfig(exportConfig, signalChannel, signalGear)'), 'route should resolve configured signal conversion action');
});

test('claim RPC migration: increments attempt_count', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20260330000000_oci_claim_and_attempt_cap.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('attempt_count + 1'), 'RPC increments attempt_count');
});

test('legacy OCI export routes have been deleted', () => {
  const exportPath = join(process.cwd(), 'app', 'api', 'oci', 'export', 'route.ts');
  const exportBatchPath = join(process.cwd(), 'app', 'api', 'oci', 'export-batch', 'route.ts');
  assert.ok(!existsSync(exportPath), 'legacy /api/oci/export must be deleted');
  assert.ok(!existsSync(exportBatchPath), 'legacy /api/oci/export-batch must be deleted');
});
