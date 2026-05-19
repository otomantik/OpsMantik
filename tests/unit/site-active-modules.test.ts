import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureDefaultSiteActiveModules,
  DEFAULT_SITE_ACTIVE_MODULES,
  OPSMANTIK_DEFAULT_MODULES,
} from '@/lib/types/modules';

test('DEFAULT_SITE_ACTIVE_MODULES: does not include google_ads_spend', () => {
  const defaults = DEFAULT_SITE_ACTIVE_MODULES as readonly string[];
  assert.equal(defaults.includes('google_ads_spend'), false);
  assert.equal(OPSMANTIK_DEFAULT_MODULES.includes('google_ads_spend'), false);
});

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
