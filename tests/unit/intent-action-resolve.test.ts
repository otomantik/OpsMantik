import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntentActionForIngest } from '@/lib/services/intent-service';

test('whitespace-only meta.intent_action falls back to event_action (phone_call preserved)', () => {
  assert.equal(
    resolveIntentActionForIngest({ intent_action: '   ' }, 'phone_call'),
    'phone_call'
  );
});

test('absent meta uses event_action', () => {
  assert.equal(resolveIntentActionForIngest({}, 'phone_call'), 'phone_call');
});

test('non-empty meta.intent_action still overrides', () => {
  assert.equal(
    resolveIntentActionForIngest({ intent_action: ' form_submit ' }, 'phone_call'),
    'form_submit'
  );
});
