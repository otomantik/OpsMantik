/**
 * P0: Status-aware backoff — getRetryDelayMs(429) delays increase with attempts and are capped.
 * No DOM; unit test only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRetryDelayMs } from '@/lib/tracker/transport';

test('getRetryDelayMs(429, 0): min 30s, within 30s + 3s jitter', () => {
  for (let i = 0; i < 5; i++) {
    const { delayMs, retry } = getRetryDelayMs(429, 0);
    assert.equal(retry, true);
    assert.ok(delayMs >= 30000 && delayMs <= 33000, `delayMs ${delayMs} in [30000, 33000]`);
  }
});

test('getRetryDelayMs(429, 1): ~60s base, within 60s + jitter', () => {
  for (let i = 0; i < 5; i++) {
    const { delayMs, retry } = getRetryDelayMs(429, 1);
    assert.equal(retry, true);
    assert.ok(delayMs >= 60000 && delayMs <= 63000, `delayMs ${delayMs} in [60000, 63000]`);
  }
});

test('getRetryDelayMs(429, attempts): delays increase then cap at 10min + jitter', () => {
  const delays: number[] = [];
  for (let a = 0; a <= 8; a++) {
    const { delayMs } = getRetryDelayMs(429, a);
    delays.push(delayMs);
  }
  assert.ok(delays[0] >= 30000);
  assert.ok(delays[1] >= 60000);
  assert.ok(delays[2] >= 120000);
  assert.ok(delays[8] <= 603000, 'cap 10min + 3s jitter');
});

test('getRetryDelayMs(400, 0): no retry', () => {
  const { delayMs, retry } = getRetryDelayMs(400, 0);
  assert.equal(retry, false);
  assert.equal(delayMs, 0);
});

test('getRetryDelayMs(404, 5): no retry', () => {
  const { retry } = getRetryDelayMs(404, 5);
  assert.equal(retry, false);
});

test('getRetryDelayMs(500, 0): min 5s, retry', () => {
  for (let i = 0; i < 3; i++) {
    const { delayMs, retry } = getRetryDelayMs(500, 0);
    assert.equal(retry, true);
    assert.ok(delayMs >= 5000 && delayMs <= 8000);
  }
});

test('getRetryDelayMs(503, 3): capped at 2min + jitter', () => {
  const { delayMs, retry } = getRetryDelayMs(503, 10);
  assert.equal(retry, true);
  assert.ok(delayMs <= 123000, 'cap 2min + 3s jitter');
});
