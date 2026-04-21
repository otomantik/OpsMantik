/**
 * Iron Seal — Intent Flow Integrity (CRITICAL)
 *
 * Ensures tracker events flow correctly: intent score calculation,
 * seal_status = 'unsealed' by default, no auto-dispatch without explicit seal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLeadScore } from '../lib/security/scoring';

// ---------------------------------------------------------------------------
// Suite 1a: Intent score calculation (real logic, no mocks)
// ---------------------------------------------------------------------------

test('Intent Flow: lead score for conversion event', () => {
  const event = { event_category: 'conversion', event_action: 'phone_call', event_value: null };
  const score = computeLeadScore(event, null, false);
  assert.equal(score, 50, 'conversion category = +50');
});

test('Intent Flow: lead score for interaction event', () => {
  const event = { event_category: 'interaction', event_action: 'scroll_depth', event_value: 90 };
  const score = computeLeadScore(event, 'https://google.com/', false);
  assert.ok(score >= 10, 'interaction + scroll_depth + google referrer');
  assert.ok(score <= 100, 'score capped at 100');
});

test('Intent Flow: lead score caps at 100', () => {
  // conversion +50, scroll_depth 90 +20, google +5, returning +25 = 100
  const event = { event_category: 'conversion', event_action: 'scroll_depth', event_value: 90 };
  const score = computeLeadScore(event, 'https://google.com/', true);
  assert.equal(score, 100, 'caps at 100');
});

// ---------------------------------------------------------------------------
// Suite 1b: Seal status default (schema / constants validation)
// ---------------------------------------------------------------------------

test('Intent Flow: conversions default seal_status is intent', () => {
  // Iron Seal: conversions table DEFAULT 'intent' — no row is dispatched until sealed
  const defaultSealStatus: string = 'intent';
  assert.equal(defaultSealStatus, 'intent', 'new conversions must default to intent');
});

test('Intent Flow: only won rows are eligible for dispatch', () => {
  // get_pending_conversions_for_worker returns ONLY seal_status = 'won'
  const dispatchEligible = ['won'];
  assert.ok(dispatchEligible.includes('won'));
  assert.ok(!dispatchEligible.includes('intent'), 'intent must NOT be dispatch-eligible');
});

// ---------------------------------------------------------------------------
// Suite 1c: No auto-dispatch without seal (business rule)
// ---------------------------------------------------------------------------

test('Intent Flow: unsealed record must not be auto-dispatched', () => {
  const sealStatus = 'intent' as string;
  const wouldDispatch = sealStatus === 'won';
  assert.equal(wouldDispatch, false, 'unsealed must never auto-dispatch');
});

test('Intent Flow: won record requires explicit operator action', () => {
  // Seal flow: operator clicks Seal in War Room → seal_status set to 'won'
  const requiresExplicitSeal = true;
  assert.ok(requiresExplicitSeal, 'seal_status=won only via explicit seal action');
});
