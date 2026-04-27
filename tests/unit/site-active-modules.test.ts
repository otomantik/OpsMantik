import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureDefaultSiteActiveModules, DEFAULT_SITE_ACTIVE_MODULES } from '@/lib/types/modules';

test('ensureDefaultSiteActiveModules: appends core_oci and scoring when missing', () => {
  const a = ensureDefaultSiteActiveModules(['dashboard', 'google_ads_spend']);
  assert.ok(a.includes('core_oci'));
  assert.ok(a.includes('scoring_v1'));
  assert.equal(a.filter((m) => m === 'core_oci').length, 1);
});

test('ensureDefaultSiteActiveModules: idempotent', () => {
  const first = ensureDefaultSiteActiveModules(undefined);
  assert.deepEqual(ensureDefaultSiteActiveModules(first), first);
  assert.equal(first.length, DEFAULT_SITE_ACTIVE_MODULES.length);
});
