import test from 'node:test';
import assert from 'node:assert/strict';
import { getSingleConversionGearRank, type SingleConversionGear } from '@/lib/oci/single-conversion-highest-only';

/** Mirrors process-outbox skip: lower contacted/offered suppressed when higher gear exists. */
function shouldSkipLowerSignalBecauseHigherGearExists(
  highestExisting: SingleConversionGear,
  requested: SingleConversionGear | 'junk'
): boolean {
  if (requested === 'junk') return false;
  if (requested !== 'contacted' && requested !== 'offered') return false;
  return getSingleConversionGearRank(highestExisting) > getSingleConversionGearRank(requested);
}

test('gear rank order: junk < contacted < offered < won', () => {
  assert.ok(getSingleConversionGearRank('junk') < getSingleConversionGearRank('contacted'));
  assert.ok(getSingleConversionGearRank('contacted') < getSingleConversionGearRank('offered'));
  assert.ok(getSingleConversionGearRank('offered') < getSingleConversionGearRank('won'));
});

test('higher gear suppresses lower contacted/offered (worker policy)', () => {
  assert.equal(shouldSkipLowerSignalBecauseHigherGearExists('won', 'contacted'), true);
  assert.equal(shouldSkipLowerSignalBecauseHigherGearExists('offered', 'contacted'), true);
  assert.equal(shouldSkipLowerSignalBecauseHigherGearExists('contacted', 'offered'), false);
  assert.equal(shouldSkipLowerSignalBecauseHigherGearExists('won', 'offered'), true);
  assert.equal(shouldSkipLowerSignalBecauseHigherGearExists('contacted', 'contacted'), false);
});
