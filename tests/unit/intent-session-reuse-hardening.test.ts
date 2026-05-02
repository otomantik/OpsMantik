import test from 'node:test';
import assert from 'node:assert/strict';
import {
  intentSessionReuseHardeningEnabledFromEnv,
} from '@/lib/config/intent-session-reuse-hardening';

test('hardening ON when INTENT_SESSION_REUSE_HARDENING is unset', () => {
  assert.equal(intentSessionReuseHardeningEnabledFromEnv({}), true);
});

test('hardening OFF when INTENT_SESSION_REUSE_HARDENING=0', () => {
  assert.equal(intentSessionReuseHardeningEnabledFromEnv({ INTENT_SESSION_REUSE_HARDENING: '0' }), false);
});

test('unknown nonempty token stays ON', () => {
  assert.equal(
    intentSessionReuseHardeningEnabledFromEnv({ INTENT_SESSION_REUSE_HARDENING: 'maybe' }),
    true
  );
});
