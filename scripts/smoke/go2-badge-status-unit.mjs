/**
 * GO2 unit-ish smoke: badge status logic (mirrors getBadgeStatus).
 * Simulates state transitions without browser; no TS import so Node can run as-is.
 */
function getBadgeStatus({ isConnected, lastSignalAt }) {
  if (!isConnected) return 'disconnected';
  if (!lastSignalAt) return 'connected';
  return 'active';
}

const assert = (condition, msg) => {
  if (!condition) throw new Error(msg);
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

test('disconnected when !isConnected', () => {
  assert(getBadgeStatus({ isConnected: false, lastSignalAt: null }) === 'disconnected');
  assert(getBadgeStatus({ isConnected: false, lastSignalAt: new Date() }) === 'disconnected');
});

test('connected when isConnected && !lastSignalAt', () => {
  assert(getBadgeStatus({ isConnected: true, lastSignalAt: null }) === 'connected');
});

test('active when isConnected && lastSignalAt', () => {
  assert(getBadgeStatus({ isConnected: true, lastSignalAt: new Date() }) === 'active');
});

console.log(`\n--- GO2 badge status unit smoke: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
