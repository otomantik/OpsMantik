import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidSiteIdentifier } from '@/lib/security/site-identifier';

test('isValidSiteIdentifier: accepts UUID', () => {
  assert.equal(isValidSiteIdentifier('00000000-0000-4000-8000-000000000001'), true);
});

test('isValidSiteIdentifier: accepts 32-hex public id', () => {
  assert.equal(isValidSiteIdentifier('aabbccddeeff00112233445566778899'), true);
});

test('isValidSiteIdentifier: rejects garbage', () => {
  assert.equal(isValidSiteIdentifier('not-a-site'), false);
  assert.equal(isValidSiteIdentifier(''), false);
});

