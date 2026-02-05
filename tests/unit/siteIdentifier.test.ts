import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidSiteIdentifier } from '@/lib/security/siteIdentifier';

test('isValidSiteIdentifier: accepts UUID', () => {
  assert.equal(isValidSiteIdentifier('01d24667-ca9a-44e3-ab7a-7cd171ae653f'), true);
});

test('isValidSiteIdentifier: accepts 32-hex public id', () => {
  assert.equal(isValidSiteIdentifier('b3e9634575df45c390d99d2623ddcde5'), true);
});

test('isValidSiteIdentifier: rejects garbage', () => {
  assert.equal(isValidSiteIdentifier('not-a-site'), false);
  assert.equal(isValidSiteIdentifier(''), false);
});

