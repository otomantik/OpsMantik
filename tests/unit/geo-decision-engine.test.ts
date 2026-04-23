import test from 'node:test';
import assert from 'node:assert/strict';
import { decideGeo } from '@/lib/geo/decision-engine';

test('locks to ADS geo when click-id is valid and ads geo exists', () => {
  const out = decideGeo({
    hasValidClickId: true,
    adsGeo: { city: 'Istanbul', district: 'Sisli / Istanbul' },
    ipGeo: { city: 'Frankfurt', district: null },
  });
  assert.equal(out.source, 'ADS');
  assert.equal(out.reasonCode, 'gclid_attribution_locked');
  assert.equal(out.city, 'Istanbul');
});

test('falls back to UNKNOWN when no click-id and ghost ip city', () => {
  const out = decideGeo({
    hasValidClickId: false,
    ipGeo: { city: 'Helsinki', district: null },
  });
  assert.equal(out.source, 'UNKNOWN');
  assert.equal(out.reasonCode, 'cf_ghost_city_quarantined');
  assert.equal(out.city, null);
});

test('uses IP when no click-id and geo looks real', () => {
  const out = decideGeo({
    hasValidClickId: false,
    ipGeo: { city: 'Istanbul', district: 'Kadikoy' },
  });
  assert.equal(out.source, 'IP');
  assert.equal(out.reasonCode, 'no_clickid_cf_primary');
  assert.equal(out.district, 'Kadikoy');
});
