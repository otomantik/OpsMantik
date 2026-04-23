#!/usr/bin/env node
import { decideGeo } from '../../lib/geo/decision-engine';

function assertCase(name: string, cond: boolean, details?: unknown): void {
  if (!cond) {
    console.error(`❌ ${name}`, details || '');
    process.exitCode = 1;
    return;
  }
  console.log(`✅ ${name}`);
}

console.log('🧪 Geo policy smoke');

const adsLocked = decideGeo({
  hasValidClickId: true,
  adsGeo: { city: 'Istanbul', district: 'Sisli / Istanbul' },
  ipGeo: { city: 'Frankfurt', district: null },
});
assertCase('gclid var -> ADS locked', adsLocked.source === 'ADS' && adsLocked.reasonCode === 'gclid_attribution_locked', adsLocked);

const noClickReal = decideGeo({
  hasValidClickId: false,
  ipGeo: { city: 'Istanbul', district: 'Besiktas' },
});
assertCase('gclid yok -> IP primary', noClickReal.source === 'IP' && noClickReal.reasonCode === 'no_clickid_cf_primary', noClickReal);

const noClickGhost = decideGeo({
  hasValidClickId: false,
  ipGeo: { city: 'Helsinki', district: null },
});
assertCase('gclid yok + ghost -> UNKNOWN', noClickGhost.source === 'UNKNOWN' && noClickGhost.reasonCode === 'cf_ghost_city_quarantined', noClickGhost);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
console.log('✅ Geo policy smoke PASS');
