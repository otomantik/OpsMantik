import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('precursor backfill uses ledger / call timestamps — not job NOW for conversion time', () => {
  const src = readFileSync(join(ROOT, 'lib', 'oci', 'backfill-precursor-signals.ts'), 'utf8');
  assert.ok(src.includes('call_funnel_ledger'), 'ledger-first backfill must query call_funnel_ledger');
  assert.ok(
    !src.includes('new Date().toISOString()'),
    'backfill must not default conversion time to wall-clock NOW()'
  );
  assert.ok(src.includes('parseIsoToDate'), 'conversion times must parse persisted ISO strings');
});
