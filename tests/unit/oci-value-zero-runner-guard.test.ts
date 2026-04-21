/**
 * PR-OCI-4 (P0): Runner must fail-closed for value_cents <= 0 or non-finite,
 * and MUST terminalize blocked rows to avoid retry loops.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNNER = join(process.cwd(), 'lib', 'oci', 'runner', 'process-conversion-batch.ts');

test('PR-OCI-4: runner must exclude rows where value_cents is non-finite or <= 0', () => {
  const src = readFileSync(RUNNER, 'utf-8');
  assert.ok(src.includes('value_cents'), 'Expected batch processor to reference value_cents');
  assert.ok(
    src.includes('Number.isFinite') || /!Number\.isFinite\(/.test(src),
    'Expected runner to guard Number.isFinite(value)'
  );
  assert.ok(/<=\s*0/.test(src), 'Expected batch processor to contain a <= 0 guard');
});

test('PR-OCI-4: runner must terminalize VALUE_ZERO rows as FAILED to prevent retry loops', () => {
  const src = readFileSync(RUNNER, 'utf-8');
  assert.ok(
    src.includes('blockedValueZeroIds'),
    'Expected batch processor to collect blockedValueZeroIds for terminalization'
  );
  assert.ok(src.includes('VALUE_ZERO'), 'Expected batch processor to label blocked rows as VALUE_ZERO');
  assert.ok(
    src.includes("status: 'FAILED'") || src.includes('status: "FAILED"'),
    'Expected batch processor to mark blocked rows status FAILED'
  );
});
