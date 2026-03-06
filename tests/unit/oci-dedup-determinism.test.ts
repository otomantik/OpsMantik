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

test('PR-OCI-9F: enqueue relies on DB unique index for dedup — no app-layer TOCTOU pre-check', () => {
  const src = readFileSync(ENQUEUE_PATH, 'utf-8');
  // The TOCTOU app-layer pre-check (duplicate_session select before insert) was intentionally
  // removed. Dedup is now enforced by the DB unique index on (site_id, provider_key, external_id).
  // A concurrent worker that passes any app-layer check will hit a 23505 on insert (caught below).
  assert.ok(
    !src.includes("in('status', ['QUEUED', 'RETRY', 'PROCESSING'])"),
    'App-layer TOCTOU pre-check must not exist; dedup is DB-enforced'
  );
  assert.ok(src.includes('23505'), 'Expected 23505 (unique violation) handling as the true dedup gate');
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
