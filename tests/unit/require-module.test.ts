/**
 * Tenant module gate: hasModule, requireModule, ModuleNotEnabledError.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasModule,
  requireModule,
  ModuleNotEnabledError,
} from '@/lib/auth/require-module';

test('hasModule: returns true when module is in active_modules', () => {
  assert.equal(hasModule({ active_modules: ['core_oci', 'scoring_v1', 'google_ads_spend'] }, 'google_ads_spend'), true);
  assert.equal(hasModule({ active_modules: ['core_oci'] }, 'core_oci'), true);
});

test('hasModule: returns false when module is missing', () => {
  assert.equal(hasModule({ active_modules: ['core_oci', 'scoring_v1'] }, 'google_ads_spend'), false);
  assert.equal(hasModule({ active_modules: [] }, 'core_oci'), false);
});

test('hasModule: returns false when active_modules is null or not array', () => {
  assert.equal(hasModule({ active_modules: null }, 'google_ads_spend'), false);
  assert.equal(hasModule({ active_modules: undefined }, 'google_ads_spend'), false);
  assert.equal(hasModule({}, 'google_ads_spend'), false);
});

test('ModuleNotEnabledError: has code and requiredModule', () => {
  const err = new ModuleNotEnabledError('site-123', 'google_ads_spend');
  assert.equal(err.code, 'MODULE_NOT_ENABLED');
  assert.equal(err.requiredModule, 'google_ads_spend');
  assert.equal(err.siteId, 'site-123');
});

test('requireModule: with site param and module present, does not throw', async () => {
  await requireModule({
    siteId: 's1',
    requiredModule: 'google_ads_spend',
    site: { id: 's1', active_modules: ['core_oci', 'google_ads_spend'] },
  });
});

test('requireModule: with site param and module missing, throws ModuleNotEnabledError', async () => {
  await assert.rejects(
    async () =>
      requireModule({
        siteId: 's1',
        requiredModule: 'google_ads_spend',
        site: { id: 's1', active_modules: ['core_oci'] },
      }),
    (e: unknown) => e instanceof ModuleNotEnabledError && e.requiredModule === 'google_ads_spend'
  );
});

test('requireModule: with site param id mismatch, does not use site param and thus may throw (DB or ModuleNotEnabledError)', async () => {
  // When site.id !== siteId, requireModule fetches from DB. Without DB we get an error (any).
  await assert.rejects(
    async () =>
      requireModule({
        siteId: 's1',
        requiredModule: 'scoring_v1',
        site: { id: 's2', active_modules: ['scoring_v1'] },
      }),
    (e: unknown) => e instanceof Error
  );
});
