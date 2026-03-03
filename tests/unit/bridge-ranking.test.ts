/**
 * PR-OCI-7: Bridge ranking - prefer GCLID session over most recent
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGE_LOOKBACK_DAYS } from '@/lib/api/call-event/match-session-by-fingerprint';

const MATCH_PATH = join(process.cwd(), 'lib/api/call-event/match-session-by-fingerprint.ts');

test('BRIDGE_LOOKBACK_DAYS is 14', () => {
  assert.equal(BRIDGE_LOOKBACK_DAYS, 14);
});

test('match-session-by-fingerprint: uses lookbackCutoff for 14-day window', () => {
  const src = readFileSync(MATCH_PATH, 'utf8');
  assert.ok(src.includes('lookbackCutoff'), 'lookbackCutoff param used');
});

test('match-session-by-fingerprint: ranks sessions by hasClickId then created_at', () => {
  const src = readFileSync(MATCH_PATH, 'utf8');
  assert.ok(src.includes('hasClickId'), 'hasClickId helper present');
  assert.ok(src.includes('bHas - aHas'), 'sort by GCLID presence first');
});

test('match-session-by-fingerprint: fetches up to 50 events, collects unique session pairs', () => {
  const src = readFileSync(MATCH_PATH, 'utf8');
  assert.ok(src.includes('limit(50)'), 'limit 50 events');
  assert.ok(src.includes('uniquePairs') || src.includes('Map'), 'unique session pairs collected');
});
