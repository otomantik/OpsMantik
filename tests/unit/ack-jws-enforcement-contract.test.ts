import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('OCI ACK route supports OCI_ACK_REQUIRE_SIGNATURE gate', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(src.includes('OCI_ACK_REQUIRE_SIGNATURE'), 'ack route should read OCI_ACK_REQUIRE_SIGNATURE');
  assert.ok(
    src.includes('OCI_ACK_SIGNATURE_REQUIRED'),
    'ack route should emit explicit log/error when signature is required but missing'
  );
});
