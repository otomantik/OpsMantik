import { test, expect } from 'vitest';

import { isValidSiteIdentifier } from '@/lib/security/site-identifier';

test('isValidSiteIdentifier: accepts UUID', () => {
  expect(isValidSiteIdentifier('01d24667-ca9a-44e3-ab7a-7cd171ae653f')).toBe(true);
});

test('isValidSiteIdentifier: accepts 32-hex public id', () => {
  expect(isValidSiteIdentifier('b3e9634575df45c390d99d2623ddcde5')).toBe(true);
});

test('isValidSiteIdentifier: rejects garbage', () => {
  expect(isValidSiteIdentifier('not-a-site')).toBe(false);
  expect(isValidSiteIdentifier('')).toBe(false);
});

