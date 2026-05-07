import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('export mark-processing terminalizes all blocked queue buckets (journal-only)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app/api/oci/google-ads-export/export-mark-processing.ts'),
    'utf8'
  );

  assert.match(src, /blockedQueueTimeIds/, 'blocked queue time IDs must be terminalized');
  assert.match(src, /blockedValueZeroIds/, 'blocked queue value-zero IDs must be terminalized');
  assert.match(src, /blockedExpiredIds/, 'blocked queue expired/value IDs must be terminalized');
});
