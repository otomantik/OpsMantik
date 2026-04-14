import test from 'node:test';
import assert from 'node:assert/strict';

import { stableInferenceDigest } from '@/lib/domain/truth/inference-digest';

test('stableInferenceDigest: key order does not change hash', () => {
  const a = stableInferenceDigest({ z: 1, a: 2, m: 3 });
  const b = stableInferenceDigest({ m: 3, z: 1, a: 2 });
  assert.equal(a, b);
});

test('stableInferenceDigest: different values change hash', () => {
  const a = stableInferenceDigest({ kind: 'x', n: 1 });
  const b = stableInferenceDigest({ kind: 'x', n: 2 });
  assert.notEqual(a, b);
});
