import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('enqueue-intent-conversion-journal-row: journal writer exists and avoids marketing_signals authority', () => {
  const p = join(process.cwd(), 'lib', 'oci', 'enqueue-intent-conversion-journal-row.ts');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /enqueueIntentConversionJournalRow/);
  assert.match(src, /offline_conversion_queue/);
  assert.doesNotMatch(src, /from\(\s*['"]marketing_signals['"]\s*\)/, 'must not query marketing_signals table');
});
