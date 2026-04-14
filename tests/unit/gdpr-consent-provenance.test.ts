import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOptionalConsentProvenance } from '@/lib/compliance/consent-provenance-shadow';

test('parseOptionalConsentProvenance: absent provenance → unknown source, not malformed', () => {
  const r = parseOptionalConsentProvenance({});
  assert.equal(r.malformed, false);
  assert.equal(r.object.source, 'unknown');
  assert.equal(r.object.updated_via, 'gdpr_consent_api');
});

test('parseOptionalConsentProvenance: cmp + policy_version', () => {
  const r = parseOptionalConsentProvenance({
    provenance: { source: 'cmp', policy_version: 'v2' },
  });
  assert.equal(r.malformed, false);
  assert.equal(r.object.source, 'cmp');
  assert.equal(r.object.policy_version, 'v2');
});

test('parseOptionalConsentProvenance: malformed type → unknown + malformed', () => {
  const r = parseOptionalConsentProvenance({ provenance: 'nope' });
  assert.equal(r.malformed, true);
  assert.equal(r.object.source, 'unknown');
});

test('parseOptionalConsentProvenance: invalid source string → unknown + malformed', () => {
  const r = parseOptionalConsentProvenance({ provenance: { source: 'nope' } });
  assert.equal(r.malformed, true);
  assert.equal(r.object.source, 'unknown');
});
