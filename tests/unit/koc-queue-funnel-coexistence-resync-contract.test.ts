import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('koc-queue-funnel-coexistence-resync.mjs: Koç default site + summary mode + APPLY delegates to pr9h6', () => {
  const p = join(process.cwd(), 'scripts', 'db', 'koc-queue-funnel-coexistence-resync.mjs');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /93cb9966bcf349c1b4ece8ea34142ace/);
  assert.match(src, /FUNNEL_COEXISTENCE_QUEUE_SUMMARY/);
  assert.match(src, /pr9h6-backfill-intents-to-oci-queue\.mjs/);
  assert.match(src, /groups_full_funnel_contacted_offered_won/);
  assert.match(src, /DEFAULT_STAGE_ALLOWLIST/);
});
