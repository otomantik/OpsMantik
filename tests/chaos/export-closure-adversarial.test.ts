/**
 * Strict / adversarial: ACK paths use DB clock authority; silent wall-clock substitution forbidden on contract stamps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('chaos: oci ack route stamps with getDbNowIso not raw Date', () => {
  const ack = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(ack.includes('getDbNowIso'), 'ack must use DB authority for contract timestamps');
});

test('chaos: oci ack-failed uses getDbNowIso for retry scheduling baseline', () => {
  const failed = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.ok(failed.includes('getDbNowIso'), 'ack-failed must anchor transitions on DB now');
});
