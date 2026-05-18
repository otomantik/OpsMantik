import test from 'node:test';
import assert from 'node:assert/strict';
import { attributionSourceFromSourceTruth } from '@/lib/attribution/attribution-from-truth';
import { classifyTraffic } from '@/lib/attribution/truth-engine-core';

test('attributionFromTruth: paid gclid → First Click (Paid)', () => {
  const v2 = classifyTraffic(
    'https://x.com/?gclid=abcdefghijklmnopqrstuvwxyz',
    '',
    'Mozilla/5.0'
  );
  const a = attributionSourceFromSourceTruth(v2);
  assert.equal(a.source, 'First Click (Paid)');
  assert.equal(a.isPaid, true);
});

test('attributionFromTruth: dark_return → Ads Assisted', () => {
  const v2 = classifyTraffic('https://x.com/', '', '', {
    channel: 'paid_search',
    timestamp: Date.now() - 3600000,
  });
  const a = attributionSourceFromSourceTruth(v2);
  assert.equal(a.source, 'Ads Assisted');
  assert.equal(a.isPaid, true);
});
