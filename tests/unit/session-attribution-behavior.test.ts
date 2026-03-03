/**
 * PR-OCI-7.1: Session attribution behavior - UTM overwrite rules.
 * Tests the pure computeUtmUpdates helper (refactor-proof).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUtmUpdates } from '@/lib/attribution';

test('equal weight Paid→Paid: utm_campaign NOT overwritten', () => {
  const session = { utm_campaign: 'A' };
  const incoming = { campaign: 'B' };
  const result = computeUtmUpdates(session, incoming, false);
  assert.equal(result.utm_campaign, undefined, 'Equal weight must not overwrite existing utm_campaign');
});

test('upgrade Organic→Paid: utm_campaign overwritten', () => {
  const session = { utm_campaign: 'A' };
  const incoming = { campaign: 'B' };
  const result = computeUtmUpdates(session, incoming, true);
  assert.equal(result.utm_campaign, 'B', 'Upgrade must overwrite utm_campaign');
});

test('enrichment: NULL utm_term set from incoming', () => {
  const session: Record<string, string | null> = { utm_term: null };
  const incoming = { term: 'x' };
  const result = computeUtmUpdates(session, incoming, false);
  assert.equal(result.utm_term, 'x', 'Enrichment (NULL→value) always allowed');
});

test('equal weight: multiple UTM fields not overwritten', () => {
  const session = { utm_source: 's1', utm_medium: 'cpc', utm_campaign: 'C1' };
  const incoming = { source: 's2', medium: 'ppc', campaign: 'C2' };
  const result = computeUtmUpdates(session, incoming, false);
  assert.equal(result.utm_source, undefined);
  assert.equal(result.utm_medium, undefined);
  assert.equal(result.utm_campaign, undefined);
});

test('upgrade: multiple UTM fields overwritten', () => {
  const session = { utm_source: 's1', utm_campaign: 'C1' };
  const incoming = { source: 's2', campaign: 'C2' };
  const result = computeUtmUpdates(session, incoming, true);
  assert.equal(result.utm_source, 's2');
  assert.equal(result.utm_campaign, 'C2');
});
