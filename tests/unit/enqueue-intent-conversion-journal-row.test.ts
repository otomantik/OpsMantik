import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '../helpers/retired-oci-vocabulary';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('enqueue-intent-conversion-journal-row: journal writer is queue-only', () => {
  const p = join(process.cwd(), 'lib', 'oci', 'enqueue-intent-conversion-journal-row.ts');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /enqueueIntentConversionJournalRow/);
  assert.match(src, /offline_conversion_queue/);
  assert.ok(!src.includes(RETIRED_FROM_CLAUSE), 'must not query retired audit table');
});
