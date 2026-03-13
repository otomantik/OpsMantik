
import { computeLcv } from './lcv-engine';

function testSingularity() {
  console.log('\n--- Testing LCV Singularity 3.0 ---');

  const case1 = computeLcv({
    stage: 'V3',
    baseAov: 3000,
    city: 'İstanbul',
    district: 'Beşiktaş',
    deviceOs: 'iOS',
    trafficSource: 'google',
    utmTerm: 'akü yol yardım',
    whatsappClicks: 1,
    totalDurationSec: 10,
    eventCount: 3,
    isReturning: true
  });

  console.log(`Case 1 (V3 Premium Singularity): ${case1.valueUnits} TL`);
  console.log(`DNA: ${case1.forensicDna}`);
  console.log(`Singularity Score: ${case1.singularityScore}%`);
  console.log(`Insights: ${case1.insights.map(i => i.label).join(', ')}`);

  const case2 = computeLcv({
    stage: 'V3',
    baseAov: 3000,
    city: 'Yozgat',
    district: 'Merkez',
    deviceOs: 'Android',
    trafficSource: 'google',
    totalDurationSec: 600,
    eventCount: 1
  });

  console.log(`\nCase 2 (V3 Weak Singularity): ${case2.valueUnits} TL`);
  console.log(`DNA: ${case2.forensicDna}`);
  console.log(`Singularity Score: ${case2.singularityScore}%`);

  if (case1.singularityScore > case2.singularityScore && case1.forensicDna !== case2.forensicDna) {
    console.log('\n✅ Singularity 3.0 Engine Verified.');
  } else {
    console.error('\n❌ Singularity Logic Mismatch.');
    process.exit(1);
  }
}

testSingularity();
