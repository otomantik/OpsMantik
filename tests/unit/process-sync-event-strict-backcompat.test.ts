/**
 * PR-T1 P0: With ingest flags OFF, worker flow remains unchanged (no skip, no geo override, no 10s reuse).
 * Source inspection of worker route and process-sync-event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_PATH = join(process.cwd(), 'lib', 'ingest', 'worker-kernel.ts');
const PROCESS_SYNC_EVENT_PATH = join(process.cwd(), 'lib', 'ingest', 'process-sync-event.ts');

test('worker: skip path only when trafficDebloat true (strict config)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  assert.ok(src.includes('trafficDebloat') && src.includes('siteIngestConfig.traffic_debloat'), 'trafficDebloat is derived from strict config');
  assert.ok(src.includes('if (trafficDebloat)'), 'bot/referrer gates only run when trafficDebloat is true');
  assert.ok(src.includes('runSyncGates(job'), 'when trafficDebloat false, flow continues to runSyncGates (no skip)');
});

test('worker: runSyncGates and processSyncEvent after trafficDebloat block (flags off => normal path)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf8');
  const ifTrafficDebloat = src.indexOf('if (trafficDebloat)');
  const runSyncGatesPos = src.indexOf('runSyncGates(job', ifTrafficDebloat);
  const processSyncEventPos = src.indexOf('processSyncEvent(job', ifTrafficDebloat);
  assert.ok(runSyncGatesPos > ifTrafficDebloat, 'runSyncGates is outside skip block');
  assert.ok(processSyncEventPos > ifTrafficDebloat, 'processSyncEvent is after gates (normal path when flags off)');
});

test('process-sync-event: ghost geo override only when ghost_geo_strict or ingest_strict_mode', () => {
  const src = readFileSync(PROCESS_SYNC_EVENT_PATH, 'utf8');
  assert.ok(src.includes('ghostGeoStrict') && src.includes('siteIngestConfig.ghost_geo_strict'), 'ghostGeoStrict derived from strict config');
  assert.ok(src.includes('ghostGeoStrict') && (src.includes('isGhostGeoCity') || src.includes('Unknown')), 'geo override conditional on ghostGeoStrict');
});

test('process-sync-event: 10s session reuse only when page_view_10s_session_reuse or ingest_strict_mode', () => {
  const src = readFileSync(PROCESS_SYNC_EVENT_PATH, 'utf8');
  assert.ok(src.includes('pageView10sReuse') && src.includes('page_view_10s_session_reuse'), 'pageView10sReuse derived from strict config');
  assert.ok(src.includes('if (pageView10sReuse && isPageView && fingerprint)'), '10s reuse only when flag true');
});

test('process-sync-event: when pageView10sReuse false, handleSession path used (no 10s lookup)', () => {
  const src = readFileSync(PROCESS_SYNC_EVENT_PATH, 'utf8');
  assert.ok(src.includes('if (!session)') && src.includes('SessionService.handleSession'), 'when no 10s match, handleSession creates session (back compat)');
});
