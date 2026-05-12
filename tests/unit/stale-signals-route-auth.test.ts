/**
 * L30: stale-signals must not be a public cross-site observability leak.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_PATH = join(process.cwd(), 'app', 'api', 'ops', 'stale-signals', 'route.ts');

test('stale-signals route: uses requireCronAuth before DB query', () => {
  const src = readFileSync(ROUTE_PATH, 'utf-8');
  assert.ok(src.includes('requireCronAuth'), 'route must use requireCronAuth');
  const idxAuth = src.indexOf('requireCronAuth');
  const idxFrom = src.indexOf("from('offline_conversion_queue')");
  assert.ok(idxAuth !== -1 && idxFrom !== -1, 'expected auth and query');
  assert.ok(idxAuth < idxFrom, 'requireCronAuth must run before querying queue');
});
