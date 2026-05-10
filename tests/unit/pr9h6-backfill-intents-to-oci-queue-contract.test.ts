import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('pr9h6-backfill-intents-to-oci-queue.mjs: dry-run default + APPLY safety gates', () => {
  const p = join(process.cwd(), 'scripts', 'db', 'pr9h6-backfill-intents-to-oci-queue.mjs');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL/);
  assert.match(src, /STAGE_ALLOWLIST_REQUIRED/);
  assert.match(src, /dry_run:\s*true/);
  assert.match(src, /resolveSiteIdentity/);
  assert.match(src, /pr9h6-backfill-queue-apply\.ts/);
});

test('pr9h6-backfill-queue-apply.ts: uses shared enqueue only; no upload ACK paths / raw id logs', () => {
  const p = join(process.cwd(), 'scripts', 'db', 'pr9h6-backfill-queue-apply.ts');
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('enqueueOciConversionRow') && src.includes('enqueueSealConversion'));
  assert.ok(!/\bconsole\.(log|error)\([^\)]*\bgclid\b/.test(src));
  assert.ok(!src.includes('ACK_FAILED') && !src.includes('markAsExported'));
  assert.ok(src.includes('pr9h6_backfill_queue_apply'));
});
