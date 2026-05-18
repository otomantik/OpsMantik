import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTraffic } from '@/lib/attribution/truth-engine-core';
import { CONTRADICTION } from '@/lib/attribution/reason-codes';

const VALID_GCLID = 'abcdefghijklmnopqrstuvwxyz';

test('T1: srsltid does not set is_paid=true', () => {
  const r = classifyTraffic(`https://example.com/?srsltid=abc123`, '', '');
  assert.equal(r.channel, 'organic_shopping');
  assert.equal(r.is_paid, false);
  assert.ok(r.selected_evidence.some((e) => e.includes('srsltid')));
});

test('T2: gclid + utm_source=tiktok → paid_search + contradiction', () => {
  const r = classifyTraffic(
    `https://example.com/?gclid=${VALID_GCLID}&utm_source=tiktok&utm_medium=cpc`,
    '',
    ''
  );
  assert.equal(r.channel, 'paid_search');
  assert.equal(r.is_paid, true);
  assert.ok(r.ignored_evidence.some((e) => e.includes('utm_source')));
  assert.ok(r.contradiction_reasons.includes(CONTRADICTION.UTM_CONTRADICTS_CLICK_ID));
  assert.ok(r.contradiction_score >= 0.7);
});

test('T3: business.google.com referrer → local_maps', () => {
  const r = classifyTraffic(
    'https://example.com/',
    'https://business.google.com/nearme',
    ''
  );
  assert.equal(r.channel, 'local_maps');
  assert.equal(r.is_paid, false);
  assert.notEqual(r.channel, 'organic_search');
});

test('T4: invalid short gclid → not paid', () => {
  const r = classifyTraffic('https://example.com/?gclid=123', '', '');
  assert.equal(r.is_paid, false);
  assert.ok(
    r.ignored_evidence.includes('param.gclid_invalid_length') ||
      r.decision_trace.some((t) => t.includes('sanitize'))
  );
});

test('T5: ChatGPT referrer → ai_referral', () => {
  const r = classifyTraffic('https://example.com/', 'https://chatgpt.com/', '');
  assert.equal(r.channel, 'ai_referral');
  assert.equal(r.is_paid, false);
});

test('T6: no referrer + utm_source=whatsapp → dark_social', () => {
  const r = classifyTraffic('https://example.com/?utm_source=whatsapp', '', '');
  assert.equal(r.channel, 'dark_social');
  assert.notEqual(r.channel, 'direct');
});

test('T7: srsltid + gclid → organic_shopping wins', () => {
  const r = classifyTraffic(
    `https://example.com/?srsltid=x&gclid=${VALID_GCLID}`,
    '',
    ''
  );
  assert.equal(r.channel, 'organic_shopping');
  assert.equal(r.is_paid, false);
});

test('T8: Instagram UA → dark_social + UA_WHISPER trace', () => {
  const r = classifyTraffic('https://example.com/', '', 'Mozilla/5.0 Instagram 123');
  assert.equal(r.channel, 'dark_social');
  assert.ok(r.decision_trace.some((t) => t.startsWith('UA_WHISPER:')));
});

test('T9: dark_return within 24h paid prior', () => {
  const r = classifyTraffic('https://example.com/', '', '', {
    channel: 'paid_search',
    timestamp: Date.now() - 60 * 60 * 1000,
  });
  assert.equal(r.channel, 'dark_return');
  assert.equal(r.is_paid, true);
  assert.ok(r.decision_trace.some((t) => t.startsWith('TEMPORAL:')));
});

test('T10: dark_return rejected after 24h', () => {
  const r = classifyTraffic('https://example.com/', '', '', {
    channel: 'paid_search',
    timestamp: Date.now() - 25 * 60 * 60 * 1000,
  });
  assert.notEqual(r.channel, 'dark_return');
});

test('T11: gclid + headless UA → fraudulent_signal', () => {
  const r = classifyTraffic(
    `https://example.com/?gclid=${VALID_GCLID}`,
    '',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0'
  );
  assert.equal(r.channel, 'fraudulent_signal');
  assert.equal(r.is_fraud_suspected, true);
  assert.equal(r.is_paid, false);
});

test('T12: identical decision_trace on replay', () => {
  const url = `https://example.com/?gclid=${VALID_GCLID}&utm_source=facebook`;
  const a = classifyTraffic(url, 'https://www.google.com/', 'Mozilla/5.0');
  const b = classifyTraffic(url, 'https://www.google.com/', 'Mozilla/5.0');
  assert.deepEqual(a.decision_trace, b.decision_trace);
  assert.equal(a.channel, b.channel);
});
