import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signPanelPreviewContext,
  verifyPanelPreviewContext,
} from '@/lib/auth/panel-preview-context';

test('signs and verifies read-only panel preview context', async () => {
  process.env.PANEL_PREVIEW_CONTEXT_SECRET = 'unit-test-preview-secret';
  const token = await signPanelPreviewContext({
    userId: 'u_123',
    siteId: 's_123',
    scope: 'ro',
  });
  const parsed = await verifyPanelPreviewContext(token);
  assert.ok(parsed);
  assert.equal(parsed?.userId, 'u_123');
  assert.equal(parsed?.siteId, 's_123');
  assert.equal(parsed?.scope, 'ro');
});

test('signs and verifies read-write panel preview context', async () => {
  process.env.PANEL_PREVIEW_CONTEXT_SECRET = 'unit-test-preview-secret';
  const token = await signPanelPreviewContext({
    userId: 'u_123',
    siteId: 's_123',
    scope: 'rw',
  });
  const parsed = await verifyPanelPreviewContext(token);
  assert.ok(parsed);
  assert.equal(parsed?.scope, 'rw');
});

test('rejects invalid preview token', async () => {
  process.env.PANEL_PREVIEW_CONTEXT_SECRET = 'unit-test-preview-secret';
  const parsed = await verifyPanelPreviewContext('invalid.token.value');
  assert.equal(parsed, null);
});
