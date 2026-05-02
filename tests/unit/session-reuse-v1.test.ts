import test from 'node:test';
import assert from 'node:assert/strict';

import {
  burstRpcSessionReuseAllowed,
  shouldReuseSessionV1,
} from '@/lib/intents/session-reuse-v1';

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

test('burstRpcSessionReuseAllowed accepts fingerprint burst within SLA', () => {
  assert.ok(
    burstRpcSessionReuseAllowed('reused_recent_fingerprint_burst', {
      matched_session_id: '8b3c52d2-1111-4aaa-8111-111111111111',
      time_delta_ms: 3_900,
    })
  );
});

test('burstRpcSessionReuseAllowed rejects fingerprint burst outside SLA', () => {
  assert.ok(
    !burstRpcSessionReuseAllowed('reused_recent_fingerprint_burst', {
      matched_session_id: '8b3c52d2-1111-4aaa-8111-111111111111',
      time_delta_ms: 9_999,
    })
  );
});

test('burstRpcSessionReuseAllowed accepts ip-entry burst within SLA', () => {
  assert.ok(
    burstRpcSessionReuseAllowed('reused_recent_ip_entry_burst', {
      matched_session_id: '8b3c52d2-2222-4aaa-8222-222222222222',
      time_delta_ms: 800,
    })
  );
});

test('burstRpcSessionReuseAllowed rejects unrelated reasons', () => {
  assert.ok(
    !burstRpcSessionReuseAllowed('reused_existing_active_signal', {
      matched_session_id: 'x',
      time_delta_ms: 100,
    })
  );
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

