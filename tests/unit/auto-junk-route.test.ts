/**
 * RED-1: Source-inspection tests for auto-junk cron route.
 * Ensures the filter uses a resolved timestamp, not a Promise (.rpc('now')).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_PATH = join(process.cwd(), 'app', 'api', 'cron', 'auto-junk', 'route.ts');

test('auto-junk route: does NOT use .rpc("now") in filter', () => {
  const src = readFileSync(ROUTE_PATH, 'utf-8');
  assert.ok(!src.includes(".rpc('now')"), 'route must not pass Promise to .lt(); use resolved timestamp');
});

test('auto-junk route: uses .lt("expires_at" with resolved timestamp', () => {
  const src = readFileSync(ROUTE_PATH, 'utf-8');
  assert.ok(src.includes(".lt('expires_at'"), 'route must filter by expires_at');
  const usesResolvedTimestamp =
    (src.includes('nowIso') && src.includes('.lt(\'expires_at\', nowIso)')) ||
    src.includes('toISOString()');
  assert.ok(usesResolvedTimestamp, 'route must use variable or toISOString for timestamp, not Promise');
});

test('auto-junk route: uses logInfo for success (no console.log)', () => {
  const src = readFileSync(ROUTE_PATH, 'utf-8');
  assert.ok(src.includes("logInfo('AUTO_JUNK_CRON_OK'"), 'route must use logInfo for success');
  assert.ok(!src.includes('console.log'), 'route must not use console.log');
});

test('auto-junk route: uses requireCronAuth', () => {
  const src = readFileSync(ROUTE_PATH, 'utf-8');
  assert.ok(src.includes('requireCronAuth'), 'route must use requireCronAuth for auth');
});
