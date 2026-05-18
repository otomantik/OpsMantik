import test from 'node:test';
import assert from 'node:assert/strict';
import { panelSitePath } from '../../lib/auth/site-operational-route';

test('panelSitePath encodes siteId query param', () => {
  const siteId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  assert.equal(panelSitePath(siteId), `/panel?siteId=${encodeURIComponent(siteId)}`);
});
