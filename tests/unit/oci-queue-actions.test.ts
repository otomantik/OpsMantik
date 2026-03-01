/**
 * OCI queue-actions: validation and status transition rules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QueueActionsBodySchema,
  QUEUE_STATUSES,
  PROVIDER_ERROR_CATEGORIES,
} from '@/lib/domain/oci/queue-types';

test('QueueActionsBodySchema: requires siteId and action and ids', () => {
  const r1 = QueueActionsBodySchema.safeParse({});
  assert.equal(r1.success, false);
  const r2 = QueueActionsBodySchema.safeParse({ siteId: 'x', action: 'RETRY_SELECTED', ids: [] });
  assert.equal(r2.success, false);
  const r3 = QueueActionsBodySchema.safeParse({
    siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    action: 'RETRY_SELECTED',
    ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  });
  assert.equal(r3.success, true);
  if (r3.success) {
    assert.equal(r3.data.clearErrors, false);
  }
});

test('QueueActionsBodySchema: accepts all actions', () => {
  for (const action of ['RETRY_SELECTED', 'RESET_TO_QUEUED', 'MARK_FAILED'] as const) {
    const r = QueueActionsBodySchema.safeParse({
      siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      action,
      ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    });
    assert.equal(r.success, true, `action ${action} should parse`);
  }
});

test('QueueActionsBodySchema: RESET_TO_QUEUED clearErrors default false', () => {
  const r = QueueActionsBodySchema.safeParse({
    siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    action: 'RESET_TO_QUEUED',
    ids: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.clearErrors, false);
});

test('queue-types: QUEUE_STATUSES includes terminal states', () => {
  assert.ok(QUEUE_STATUSES.includes('COMPLETED'));
  assert.ok(QUEUE_STATUSES.includes('FAILED'));
  assert.ok(QUEUE_STATUSES.includes('QUEUED'));
  assert.ok(QUEUE_STATUSES.includes('RETRY'));
  assert.ok(QUEUE_STATUSES.includes('PROCESSING'));
});

test('queue-types: PROVIDER_ERROR_CATEGORIES includes PERMANENT', () => {
  assert.ok(PROVIDER_ERROR_CATEGORIES.includes('PERMANENT'));
  assert.ok(PROVIDER_ERROR_CATEGORIES.includes('TRANSIENT'));
  assert.ok(PROVIDER_ERROR_CATEGORIES.includes('VALIDATION'));
});
