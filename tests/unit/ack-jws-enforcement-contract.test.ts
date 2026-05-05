import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('OCI ACK route enforces OCI_ACK_REQUIRE_SIGNATURE via shared policy', () => {
  const src = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(src.includes('evaluateOciAckSignaturePolicy'), 'ack route should use shared signature policy helper');
  assert.ok(
    src.includes('signature_required'),
    'ack route should log signature_required decision metadata'
  );
});
