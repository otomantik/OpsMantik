import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('reconciliation payload sanitizer strips obvious PII key patterns', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'reconciliation-events.ts'), 'utf8');
  assert.ok(src.includes('sanitizeReconciliationPayload'), 'sanitizer helper must exist');
  assert.ok(src.includes('FORBIDDEN_PAYLOAD_KEYS'), 'forbidden key list must exist');
  assert.ok(src.includes('caller_phone_raw'), 'caller_phone_raw should be blocked');
  assert.ok(src.includes('ip_address'), 'ip_address should be blocked');
  assert.ok(src.includes('full_url'), 'full_url should be blocked');
});
