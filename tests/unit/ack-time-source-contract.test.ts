import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('OCI ACK route uses DB-authoritative clock for transition stamps', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(src.includes("getDbNowIso"), 'ack route should import getDbNowIso');
  assert.ok(/const\s+now\s*=\s*await\s+getDbNowIso\s*\(\)/.test(src), 'ack should assign now from getDbNowIso()');
});
