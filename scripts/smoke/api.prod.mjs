/**
 * API Smoke Tests - Production Endpoint Validation
 * 
 * Tests:
 * - CORS allow/deny
 * - Input validation (site_id, url)
 * - Happy path
 * 
 * Environment Variables:
 * - SMOKE_BASE_URL (default: https://console.opsmantik.com)
 * - SMOKE_SITE_ID (required)
 * - SMOKE_ORIGIN_ALLOWED (default: https://www.sosreklam.com)
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://console.opsmantik.com';
const SITE_ID = process.env.SMOKE_SITE_ID;
const ORIGIN_ALLOWED = process.env.SMOKE_ORIGIN_ALLOWED || 'https://www.sosreklam.com';
const ORIGIN_DENIED = 'https://evil-example.com';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition, message) {
  if (!condition) {
    log(`❌ FAIL: ${message}`, 'red');
    process.exit(1);
  }
  log(`✅ PASS: ${message}`, 'green');
}

async function testCORSAllow() {
  log('\n📋 Test 1: CORS Allow (Allowed Origin)', 'blue');
  
  const response = await fetch(`${BASE_URL}/api/sync`, {
    method: 'OPTIONS',
    headers: {
      'Origin': ORIGIN_ALLOWED,
      'Access-Control-Request-Method': 'POST',
    },
  });
  
  assert(response.status === 200, `OPTIONS request should return 200 (got ${response.status})`);
  
  const acao = response.headers.get('Access-Control-Allow-Origin');
  assert(acao === ORIGIN_ALLOWED, `ACAO should be ${ORIGIN_ALLOWED} (got ${acao})`);
  
  log(`   Response: ${response.status} OK, ACAO: ${acao}`, 'reset');
}

async function testCORSDeny() {
  log('\n📋 Test 2: CORS Deny (Blocked Origin)', 'blue');
  
  const response = await fetch(`${BASE_URL}/api/sync`, {
    method: 'OPTIONS',
    headers: {
      'Origin': ORIGIN_DENIED,
      'Access-Control-Request-Method': 'POST',
    },
  });
  
  assert(response.status === 200, `OPTIONS request should return 200 (got ${response.status})`);
  
  const acao = response.headers.get('Access-Control-Allow-Origin');
  assert(acao !== ORIGIN_DENIED, `ACAO should NOT be ${ORIGIN_DENIED} (got ${acao})`);
  
  log(`   Response: ${response.status} OK, ACAO: ${acao} (not ${ORIGIN_DENIED})`, 'reset');
}

async function testInputValidationSiteId() {
  log('\n📋 Test 3: Input Validation - Invalid site_id', 'blue');
  
  const response = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN_ALLOWED,
    },
    body: JSON.stringify({
      s: 'not-a-uuid',
      u: 'https://example.com',
      sid: '550e8400-e29b-41d4-a716-446655440000',
      sm: '2026-01-01',
      ec: 'interaction',
      ea: 'view',
    }),
  });
  
  assert(response.status === 400, `Should return 400 for invalid site_id (got ${response.status})`);
  
  const data = await response.json();
  assert(data.status === 'error', `Response should have status: 'error' (got ${data.status})`);
  assert(data.message === 'Invalid site_id format', `Message should be 'Invalid site_id format' (got ${data.message})`);
  
  log(`   Response: ${response.status} ${JSON.stringify(data)}`, 'reset');
}

async function testInputValidationUrl() {
  log('\n📋 Test 4: Input Validation - Invalid URL', 'blue');
  
  if (!SITE_ID) {
    log('⚠️  SKIP: SMOKE_SITE_ID not set, skipping URL validation test', 'yellow');
    return;
  }
  
  const response = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN_ALLOWED,
    },
    body: JSON.stringify({
      s: SITE_ID,
      u: 'not-a-url',
      sid: '550e8400-e29b-41d4-a716-446655440000',
      sm: '2026-01-01',
      ec: 'interaction',
      ea: 'view',
    }),
  });
  
  assert(response.status === 400, `Should return 400 for invalid URL (got ${response.status})`);
  
  const data = await response.json();
  assert(data.status === 'error', `Response should have status: 'error' (got ${data.status})`);
  assert(data.message === 'Invalid url format', `Message should be 'Invalid url format' (got ${data.message})`);
  
  log(`   Response: ${response.status} ${JSON.stringify(data)}`, 'reset');
}

async function testHappyPath() {
  log('\n📋 Test 5: Happy Path (Valid Request)', 'blue');
  
  if (!SITE_ID) {
    log('⚠️  SKIP: SMOKE_SITE_ID not set, skipping happy path test', 'yellow');
    return;
  }
  
  const response = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': ORIGIN_ALLOWED,
    },
    body: JSON.stringify({
      s: SITE_ID,
      u: 'https://example.com/test',
      sid: '550e8400-e29b-41d4-a716-446655440000',
      sm: '2026-01-01',
      ec: 'interaction',
      ea: 'view',
      el: 'test',
      ev: null,
      r: 'https://google.com',
      meta: {
        fp: 'test-fingerprint-123',
      },
    }),
  });
  
  assert(response.status === 200, `Should return 200 for valid request (got ${response.status})`);
  
  const data = await response.json();
  assert(data.status === 'synced', `Response should have status: 'synced' (got ${data.status})`);
  assert(typeof data.score === 'number', `Response should have score (number) (got ${typeof data.score})`);
  
  log(`   Response: ${response.status} ${JSON.stringify(data)}`, 'reset');
}

async function runTests() {
  log('🚀 Starting API Smoke Tests', 'blue');
  log(`   Base URL: ${BASE_URL}`, 'reset');
  log(`   Allowed Origin: ${ORIGIN_ALLOWED}`, 'reset');
  log(`   Denied Origin: ${ORIGIN_DENIED}`, 'reset');
  log(`   Site ID: ${SITE_ID || 'NOT SET (some tests will be skipped)'}`, SITE_ID ? 'reset' : 'yellow');
  
  try {
    await testCORSAllow();
    await testCORSDeny();
    await testInputValidationSiteId();
    await testInputValidationUrl();
    await testHappyPath();
    
    log('\n✅ All smoke tests passed!', 'green');
    process.exit(0);
  } catch (error) {
    log(`\n❌ Smoke test failed: ${error.message}`, 'red');
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run tests
runTests();
