import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('intent status mutation route applies reviewed lifecycle contract', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'intents', '[id]', 'status', 'route.ts'), 'utf8');
  assert.ok(src.includes("p_reviewed: actionType !== 'restore'"), 'restore must clear reviewed fields atomically');
  assert.ok(src.includes("apply_call_action_with_review_v1"), 'status/review must be atomic via single RPC');
  assert.ok(src.includes('source_surface'), 'route must capture source surface for forensics');
  assert.ok(src.includes('INTENT_DUPLICATE_FORENSICS') || src.includes('intent status mutation forensics'), 'route must emit forensics log');
});

test('review endpoint exists and marks only intent/contacted rows', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'intents', '[id]', 'review', 'route.ts'), 'utf8');
  assert.ok(src.includes("status !== 'intent' && status !== 'contacted'"), 'review endpoint must reject terminal/non-queue statuses');
  assert.ok(src.includes('reviewed_at'), 'review endpoint must set reviewed_at');
  assert.ok(src.includes('reviewed_by'), 'review endpoint must set reviewed_by');
});

