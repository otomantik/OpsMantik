import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldReuseSessionV1 } from '@/lib/intents/session-reuse-v1';

test('shouldReuseSessionV1 accepts valid active candidate within 90 seconds', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 45_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, true);
  assert.equal(result.reason, 'reusable_session');
});

test('shouldReuseSessionV1 rejects missing click id', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: null,
    primaryClickIdValid: false,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 5_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'missing_click_id');
});

test('shouldReuseSessionV1 rejects invalid click id', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'bad',
    primaryClickIdValid: false,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 5_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'invalid_click_id');
});

test('shouldReuseSessionV1 rejects target mismatch', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112244',
    timeDeltaMs: 10_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'intent_target_mismatch');
});

test('shouldReuseSessionV1 rejects action mismatch', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'whatsapp',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: 'whatsapp:+905551112233',
    candidateIntentTarget: 'whatsapp:+905551112233',
    timeDeltaMs: 10_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'intent_action_mismatch');
});

test('shouldReuseSessionV1 rejects over 90 seconds', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 91_000,
    lifecycleStatus: 'intent',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'time_window_exceeded');
});

test('shouldReuseSessionV1 rejects terminal statuses', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 30_000,
    lifecycleStatus: 'won',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'terminal_status');
});

test('shouldReuseSessionV1 rejects merged archival status', () => {
  const result = shouldReuseSessionV1({
    siteMatches: true,
    primaryClickId: 'gclid-123',
    primaryClickIdValid: true,
    intentAction: 'phone',
    candidateIntentAction: 'phone',
    normalizedIntentTarget: '+905551112233',
    candidateIntentTarget: '+905551112233',
    timeDeltaMs: 30_000,
    lifecycleStatus: 'merged',
    candidateSessionId: 'session-1',
  });
  assert.equal(result.reuse, false);
  assert.equal(result.reason, 'archival_status');
});

