/**
 * Unit tests for GET google-ads-export query strict schema helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectUnknownExportQueryKeys,
  exportQueryParamsToStrictInput,
  googleAdsExportQueryStringsSchema,
} from '@/lib/oci/schemas/google-ads-export-query.zod';

test('collectUnknownExportQueryKeys: flags keys outside allow-list', () => {
  const u = new URL('http://x/api?siteId=a&evil=1&limit=10');
  assert.deepEqual(collectUnknownExportQueryKeys(u.searchParams), ['evil']);
});

test('googleAdsExportQueryStringsSchema: rejects limit string longer than max(8)', () => {
  const input = exportQueryParamsToStrictInput(new URL('http://x/?limit=123456789').searchParams);
  const r = googleAdsExportQueryStringsSchema.safeParse(input);
  assert.equal(r.success, false);
});

test('googleAdsExportQueryStringsSchema: rejects unknown keys when merged into strict object', () => {
  const r = googleAdsExportQueryStringsSchema.safeParse({ siteId: 'x', extra: '1' } as Record<string, string>);
  assert.equal(r.success, false);
});
