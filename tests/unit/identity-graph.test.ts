import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShadowId,
  stitchSessions,
  uaJaccardSimilarity,
} from '@/lib/attribution/identity-graph';

test('generateShadowId stable', () => {
  const a = generateShadowId('203.0.113.45', 'Mozilla/5.0', 'en-US', -180);
  const b = generateShadowId('203.0.113.45', 'Mozilla/5.0', 'en-US', -180);
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('stitchSessions inherits gclid from shadow match', () => {
  const shadowId = generateShadowId('203.0.113.99', 'Mobile UA', 'tr', 180);
  const now = Date.now();
  const r = stitchSessions(
    { shadowId, userAgent: 'Desktop UA', ip_subnet: '203.0.113.0/24', hasLandingClickId: false },
    [
      {
        shadow_id_digest: shadowId,
        session_id: 'mobile-1',
        created_at: now - 2 * 60 * 60 * 1000,
        gclid: 'abcdefghijklmnopqrstuvwxyz',
        user_agent: 'Mobile UA',
      },
    ],
    now
  );
  assert.equal(r.matched, true);
  assert.equal(r.inherited_click_ids?.gclid, 'abcdefghijklmnopqrstuvwxyz');
  assert.ok(r.trace_message?.includes('IDENTITY_GRAPH'));
});

test('uaJaccardSimilarity high for similar UAs', () => {
  const s = uaJaccardSimilarity('Mozilla/5.0 Mobile Safari', 'Mozilla/5.0 Mobile Chrome');
  assert.ok(s >= 0.5);
});
