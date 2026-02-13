/**
 * Admin guard: non-admin must receive 403, not just "logged in" check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdminResponse } from '@/lib/auth/require-admin';

test('requireAdminResponse(false) returns 403', () => {
  const res = requireAdminResponse(false);
  assert.ok(res !== null);
  assert.equal(res.status, 403);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
});

test('requireAdminResponse(true) returns null', () => {
  const res = requireAdminResponse(true);
  assert.equal(res, null);
});
