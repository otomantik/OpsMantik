/**
 * PR-OCI-9F: Dedup determinism — enqueue handles duplicate_session and 23505.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeOfflineConversionExternalId } from '@/lib/oci/external-id';

const ENQUEUE_PATH = join(process.cwd(), 'lib', 'oci', 'enqueue-seal-conversion.ts');

test('PR-OCI-9F: enqueue checks duplicate_session before insert', () => {
  const src = readFileSync(ENQUEUE_PATH, 'utf-8');
  assert.ok(src.includes('duplicate_session'), 'Expected duplicate_session pre-check');
  assert.ok(
    src.includes("'QUEUED', 'RETRY', 'PROCESSING'") || src.includes('QUEUED", "RETRY", "PROCESSING"'),
    'Expected status filter for pending rows'
  );
});

test('PR-OCI-9F: enqueue handles 23505 as duplicate', () => {
  const src = readFileSync(ENQUEUE_PATH, 'utf-8');
  assert.ok(src.includes('23505'), 'Expected 23505 (unique violation) handling');
  assert.ok(
    src.includes("reason: 'duplicate'") || src.includes('reason: "duplicate"'),
    'Expected duplicate reason on 23505'
  );
});

test('PR-OCI-9F: external_id helper is deterministic for the same logical OCI row', () => {
  const a = computeOfflineConversionExternalId({
    providerKey: 'google_ads',
    action: 'purchase',
    callId: 'call-1',
    sessionId: 'session-1',
  });
  const b = computeOfflineConversionExternalId({
    providerKey: 'google_ads',
    action: 'purchase',
    callId: 'call-1',
    sessionId: 'session-1',
  });
  const c = computeOfflineConversionExternalId({
    providerKey: 'google_ads',
    action: 'purchase',
    callId: 'call-2',
    sessionId: 'session-1',
  });
  assert.equal(a, b, 'same logical identity must hash to same external_id');
  assert.notEqual(a, c, 'different logical identity must not reuse external_id');
});
