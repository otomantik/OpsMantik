/**
 * PR-OCI-4 (P0): pipeline-service must not enqueue non-finite / <=0 values.
 * Source-inspection test (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PIPELINE = join(process.cwd(), 'lib', 'services', 'pipeline-service.ts');

test('PR-OCI-4: pipeline-service blocks non-finite or <=0 finalValueCents', () => {
  const src = readFileSync(PIPELINE, 'utf-8');
  assert.ok(
    src.includes('finalValueCents'),
    'Expected pipeline-service to reference finalValueCents'
  );
  assert.ok(
    src.includes('Number.isFinite(finalValueCents)') || src.includes('!Number.isFinite(finalValueCents)'),
    'Expected pipeline-service to guard Number.isFinite(finalValueCents)'
  );
  assert.ok(
    /finalValueCents\s*<=\s*0/.test(src),
    'Expected pipeline-service to guard finalValueCents <= 0'
  );
});
