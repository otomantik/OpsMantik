import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRpcTimestampMs } from '../../lib/queue/parse-rpc-timestamp-ms';
import { dedupeByIdOrCanonicalKey } from '../../lib/queue/dedupe-by-canonical-intent-key';
import type { HunterIntentLite } from '../../lib/types/hunter';

const ROOT = process.cwd();

test('parseRpcTimestampMs normalizes Postgres space-separated timestamps', () => {
  const ms = parseRpcTimestampMs('2026-05-17 23:47:40.174963+00');
  assert.ok(Number.isFinite(ms));
  assert.equal(new Date(ms).toISOString().slice(0, 19), '2026-05-17T23:47:40');
});

test('dedupeByIdOrCanonicalKey keeps newest row per canonical_intent_key', () => {
  const rows = [
    { id: 'a', canonical_intent_key: 'k1', created_at: '2026-05-01 10:00:00+00' },
    { id: 'b', canonical_intent_key: 'k1', created_at: '2026-05-02 10:00:00+00' },
  ] as HunterIntentLite[];
  const out = dedupeByIdOrCanonicalKey(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'b');
});

test('use-queue-controller imports queue dedupe helpers (no inline duplicates)', () => {
  const src = readFileSync(join(ROOT, 'lib', 'hooks', 'use-queue-controller.ts'), 'utf8');
  assert.ok(src.includes("from '@/lib/queue/parse-rpc-timestamp-ms'"));
  assert.ok(src.includes("from '@/lib/queue/dedupe-by-canonical-intent-key'"));
  assert.ok(!src.includes('function parseRpcTimestampMs('));
  assert.ok(!src.includes('function dedupeByIdOrCanonicalKey('));
});
