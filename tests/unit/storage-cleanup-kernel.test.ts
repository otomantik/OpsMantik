import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLimitHit,
  parseRpcAffected,
  STORAGE_CLEANUP_APPROVAL_ENV,
  STORAGE_CLEANUP_APPROVAL_VALUE,
} from '@/lib/storage/cleanup-kernel';
import { resetRefactorMetricsMemoryForTests, getRefactorMetricsMemory } from '@/lib/refactor/metrics';

test('parseRpcAffected handles jsonb and integer', () => {
  assert.equal(parseRpcAffected(42), 42);
  assert.equal(parseRpcAffected({ affected: 7 }), 7);
  assert.equal(parseRpcAffected({ sessions_affected: 1 }), 0);
});

test('assessLimitHit increments metric when at limit', () => {
  resetRefactorMetricsMemoryForTests();
  const a = assessLimitHit(5000, 5000);
  assert.equal(a.limitHit, true);
  assert.equal(a.level, 'info');
  assert.equal(getRefactorMetricsMemory().storage_cleanup_limit_hit_total, 1);
});

test('assessLimitHit none below limit', () => {
  const a = assessLimitHit(100, 5000);
  assert.equal(a.limitHit, false);
});

test('approval env constants', () => {
  assert.equal(STORAGE_CLEANUP_APPROVAL_ENV, 'OPSMANTIK_STORAGE_CLEANUP_APPROVAL');
  assert.equal(STORAGE_CLEANUP_APPROVAL_VALUE, 'I_APPROVE_STORAGE_MUTATION');
});
