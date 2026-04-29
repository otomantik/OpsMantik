import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATION = join(
  ROOT,
  'supabase',
  'migrations',
  '20260429183000_active_session_single_card_guard.sql'
);

test('active session single-card migration defines unique active click guard', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(
    src.includes('idx_calls_active_click_single_card_per_session'),
    'migration must define unique active session guard index'
  );
  assert.ok(
    src.includes('UNIQUE INDEX') || src.includes('CREATE UNIQUE INDEX'),
    'migration must enforce uniqueness at DB level'
  );
  assert.ok(
    src.includes("lower(coalesce(status, 'intent')) IN ('intent', 'contacted', 'offered', 'won', 'confirmed')"),
    'active status family must be explicit in guard index'
  );
});

