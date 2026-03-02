/**
 * Unit tests for lib/ingest/bot-referrer-gates: isCommonBotUA, hasValidClickId, isAllowedReferrer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCommonBotUA,
  hasValidClickId,
  isAllowedReferrer,
} from '@/lib/ingest/bot-referrer-gates';

test('isCommonBotUA: hard bots always match', () => {
  assert.equal(isCommonBotUA('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isCommonBotUA('curl/7.68.0'), true);
  assert.equal(isCommonBotUA('HeadlessChrome/91'), true);
  assert.equal(isCommonBotUA('Lighthouse'), true);
  assert.equal(isCommonBotUA('Wget/1.20'), true);
});

test('isCommonBotUA: preview bots skip unless allowPreviewUAs', () => {
  assert.equal(isCommonBotUA('WhatsApp/2.0'), true);
  assert.equal(isCommonBotUA('WhatsApp/2.0', { allowPreviewUAs: true }), false);
  assert.equal(isCommonBotUA('facebookexternalhit/1.1'), true);
  assert.equal(isCommonBotUA('facebookexternalhit/1.1', { allowPreviewUAs: true }), false);
});

test('isCommonBotUA: normal UA returns false', () => {
  assert.equal(isCommonBotUA('Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0'), false);
  assert.equal(isCommonBotUA(null), false);
  assert.equal(isCommonBotUA(''), false);
});

test('hasValidClickId: length >= 10 required', () => {
  assert.equal(hasValidClickId({ gclid: '1' }), false);
  assert.equal(hasValidClickId({ gclid: 'EAIaIQobChMI' }), true);
  assert.equal(hasValidClickId({ wbraid: 'short' }), false);
  assert.equal(hasValidClickId({ wbraid: 'wbraid_long_enough_12345' }), true);
  assert.equal(hasValidClickId({ gclid: null, wbraid: null, gbraid: null }), false);
});

test('isAllowedReferrer: no referrer (direct) allowed', () => {
  assert.equal(
    isAllowedReferrer(null, 'https://example.com/page', { eventHost: 'example.com' }),
    true
  );
  assert.equal(
    isAllowedReferrer('', 'https://example.com/page', { eventHost: 'example.com' }),
    true
  );
});

test('isAllowedReferrer: same-site allowed', () => {
  assert.equal(
    isAllowedReferrer('https://example.com/other', 'https://example.com/page', { eventHost: 'example.com' }),
    true
  );
  assert.equal(
    isAllowedReferrer('https://www.example.com/ref', 'https://example.com/page', { eventHost: 'example.com' }),
    true
  );
});

test('isAllowedReferrer: google in allowlist', () => {
  assert.equal(
    isAllowedReferrer('https://www.google.com/search?q=test', 'https://mysite.com/', { eventHost: 'mysite.com' }),
    true
  );
});

test('isAllowedReferrer: unknown referrer without click-id context denied (when not in allowlist)', () => {
  // random gambling/suspicious host not in default allowlist
  const cfg = { eventHost: 'mysite.com', allowlist: [], blocklist: [] };
  assert.equal(
    isAllowedReferrer('https://unknown-ads-network.example/', 'https://mysite.com/', cfg),
    false
  );
});

test('config/env: referrer allowlist from config preferred', () => {
  const cfg = { eventHost: 'x.com', allowlist: ['custom.source.com'], blocklist: [] };
  assert.equal(
    isAllowedReferrer('https://custom.source.com/page', 'https://x.com/', cfg),
    true
  );
});
