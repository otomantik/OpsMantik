import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceTruthForExport } from '@/lib/oci/source-truth-export-guard';
import { classifyTraffic } from '@/lib/attribution/truth-engine-core';

test('blocks fraudulent_signal ledger', () => {
  const ledger = classifyTraffic(
    'https://x.com/?gclid=abcdefghijklmnopqrstuvwxyz',
    '',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0'
  );
  const r = validateSourceTruthForExport(ledger);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'SOURCE_TRUTH_FRAUD');
});

test('allows paid_search ledger', () => {
  const ledger = classifyTraffic(
    'https://x.com/?gclid=abcdefghijklmnopqrstuvwxyz',
    '',
    'Mozilla/5.0'
  );
  assert.equal(validateSourceTruthForExport(ledger).ok, true);
});
