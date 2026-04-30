import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCanonicalIntentKey } from '@/lib/intents/canonical-intent-key';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260430153000_intent_stabilization_lifecycle_armor.sql');

test('canonical intent key helper is deterministic', () => {
  const a = buildCanonicalIntentKey({
    siteId: 'site-1',
    matchedSessionId: 'sess-1',
    intentAction: 'Phone',
    occurredAt: '2026-04-30T12:34:56.999Z',
  });
  const b = buildCanonicalIntentKey({
    siteId: 'site-1',
    matchedSessionId: 'sess-1',
    intentAction: 'phone',
    occurredAt: '2026-04-30T12:34:00.000Z',
  });
  assert.equal(a, b, 'same minute/session/action must produce same fallback key');
  const callScoped = buildCanonicalIntentKey({
    callId: 'abc-123',
    siteId: 'site-1',
    matchedSessionId: 'sess-1',
    intentAction: 'phone',
    occurredAt: '2026-04-30T12:34:00.000Z',
  });
  assert.equal(callScoped, b, 'call id must not alter canonical dedupe key');
});

test('intent lifecycle migration adds reviewed and canonical contracts', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('ADD COLUMN IF NOT EXISTS reviewed_at timestamptz'), 'reviewed_at must be added');
  assert.ok(src.includes('ADD COLUMN IF NOT EXISTS reviewed_by uuid'), 'reviewed_by must be added');
  assert.ok(src.includes('ADD COLUMN IF NOT EXISTS canonical_intent_key text'), 'canonical_intent_key must be added');
  assert.ok(src.includes('calls_site_canonical_intent_key_uniq'), 'partial unique index must exist');
  assert.ok(src.includes("WHERE canonical_intent_key IS NOT NULL"), 'unique index must be partial on non-null key');
  assert.ok(src.includes('p_only_unreviewed boolean DEFAULT true'), 'RPC must expose only_unreviewed');
  assert.ok(src.includes('p_include_reviewed boolean DEFAULT false'), 'RPC must expose include_reviewed');
  assert.ok(src.includes('reviewed_at IS NULL'), 'default queue filter must honor reviewed_at');
});

test('queue controller removes optimistic queue deletion path', () => {
  const src = readFileSync(join(ROOT, 'lib', 'hooks', 'use-queue-controller.ts'), 'utf8');
  assert.ok(!src.includes('optimisticRemove('), 'optimistic remove should be removed from queue flow');
  assert.ok(src.includes('fetchRecentEntered'), 'queue controller should fetch recent entered list');
});

