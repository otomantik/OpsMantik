/**
 * Intent retention policy: 90d TTL, human-first auto-junk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTENT_AUTO_JUNK_RETENTION_DAYS } from '@/lib/product/intent-retention';

const ROOT = process.cwd();

test('intent retention constant is 90 days', () => {
  assert.equal(INTENT_AUTO_JUNK_RETENTION_DAYS, 90);
});

test('migration sets 90-day expires_at trigger and backfill', () => {
  const src = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261322120000_intent_retention_90d_human_first_v1.sql'),
    'utf8'
  );
  assert.ok(src.includes("ADD COLUMN IF NOT EXISTS expires_at"), 'prod must gain expires_at when missing');
  assert.ok(src.includes("INTERVAL '90 days'"), 'trigger must use 90-day TTL');
  assert.ok(src.includes('trg_calls_standard_expiration'), 'insert trigger must be (re)created');
  assert.ok(src.includes('reviewed_at IS NULL'), 'backfill and cleanup must respect human review');
});

test('auto-junk skips human-reviewed intent rows', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'auto-junk', 'route.ts'), 'utf8');
  assert.ok(src.includes(".is('reviewed_at', null)"), 'auto-junk must not junk reviewed rows');
  assert.ok(src.includes('INTENT_AUTO_JUNK_RETENTION_DAYS'), 'route must reference retention constant');
});
