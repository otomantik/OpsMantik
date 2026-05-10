import test from 'node:test';
import assert from 'node:assert/strict';
import { hashNormalizedEmail } from '@/lib/oci/validation/crypto';

test('hashNormalizedEmail lowercases and trims before hash', () => {
  const a = hashNormalizedEmail('  Test@Example.COM ');
  const b = hashNormalizedEmail('test@example.com');
  assert.equal(a, b);
});
