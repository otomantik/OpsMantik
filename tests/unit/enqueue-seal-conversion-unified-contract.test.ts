import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Seal won path delegates to enqueueIntentConversionJournalRow with OpsMantik_Won + idempotency', () => {
  const seal = readFileSync(join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.match(seal, /enqueueIntentConversionJournalRow\(/);
  assert.match(seal, /conversionName:\s*OPSMANTIK_CONVERSION_NAMES\.won/);
  assert.match(seal, /sourceIdempotencyKey:\s*wonExternalId/);
  assert.match(seal, /journalRes\.reason === 'duplicate'/);
  assert.match(seal, /fastTrackDedupeLabel:\s*'seal_fasttrack'/);
  assert.match(seal, /providerPathOverride:\s*scriptPath/);
});
