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
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE;
const GITHUB_ACTIONS = process.env.GITHUB_ACTIONS;
const SMOKE_FORCE_FAIL = process.env.SMOKE_FORCE_FAIL === 'true';
const isCI = GITHUB_ACTIONS === 'true';

// Test results tracking
const testResults = [];
let firstFailure = null;
const failureArtifacts = []; // Track raw responses for artifact upload

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
    if (!firstFailure) {
      firstFailure = message;
    }
    log(`❌ FAIL: ${message}`, 'red');
    throw new Error(message);
  }
  log(`✅ PASS: ${message}`, 'green');
}

function saveFailureArtifact(name, data) {
  // Gate: Only save artifacts in CI (GitHub Actions) or when forced fail is enabled
  if (!isCI && !SMOKE_FORCE_FAIL) {
    return null; // Not running in CI and not forced fail mode
  }

  try {
    const fs = require('fs');
    const path = require('path');
    
    // Use GITHUB_WORKSPACE in CI, or current working directory for forced fail testing
    const workspaceDir = GITHUB_WORKSPACE || process.cwd();
    const artifactsDir = path.join(workspaceDir, 'smoke-artifacts');
    
    // Create artifacts directory if it doesn't exist
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    
    // Artifact filename: test-name-timestamp.json (deterministic and readable)
    const timestamp = Date.now();
    const artifactPath = path.join(artifactsDir, `${name}-${timestamp}.json`);
    
    fs.writeFileSync(artifactPath, JSON.stringify(data, null, 2), 'utf8');
    failureArtifacts.push(artifactPath);
    return artifactPath;
  } catch (error) {
    // Silently fail - don't break test run
    return null;
  }
}

function writeStepSummary() {
  if (!GITHUB_STEP_SUMMARY) {
    return; // Not running in GitHub Actions
  }

  const fs = require('fs');
  const passed = testResults.filter(t => t.status === 'pass').length;
  const failed = testResults.filter(t => t.status === 'fail').length;
  const skipped = testResults.filter(t => t.status === 'skip').length;
  const total = testResults.length;

  const summary = `# API Smoke Tests Summary

## Configuration
- **Base URL:** ${BASE_URL}
- **Allowed Origin:** ${ORIGIN_ALLOWED}
- **Site ID:** ${SITE_ID ? '✓ Set' : '⚠ Not set (some tests skipped)'}

## Test Results

| Test | Status | Details |
|------|--------|---------|
${testResults.map(t => {
  const statusIcon = t.status === 'pass' ? '✅' : t.status === 'skip' ? '⚠️' : '❌';
  return `| ${t.name} | ${statusIcon} ${t.status.toUpperCase()} | ${t.details || '-'} |`;
}).join('\n')}

## Summary
- **Total:** ${total} tests
- **Passed:** ${passed} ✅
- **Failed:** ${failed} ${failed > 0 ? '❌' : ''}
- **Skipped:** ${skipped} ${skipped > 0 ? '⚠️' : ''}

${failed > 0 ? `## First Failure\n\n\`\`\`\n${firstFailure}\n\`\`\`` : ''}

${failed === 0 && skipped === 0 ? '## ✅ All tests passed!' : ''}
${failed > 0 ? '## ❌ Some tests failed' : ''}
${skipped > 0 && failed === 0 ? '## ⚠️ Some tests skipped (SMOKE_SITE_ID not set)' : ''}
`;

  try {
    fs.writeFileSync(GITHUB_STEP_SUMMARY, summary, 'utf8');
  } catch (error) {
    // Silently fail if we can't write (e.g., permissions)
    // Don't break the test run
  }
}

async function testCORSAllow() {
  log('\n📋 Test 1: CORS Allow (Allowed Origin)', 'blue');
  const testName = '1. CORS Allow (Allowed Origin)';
  
  try {
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
    testResults.push({ name: testName, status: 'pass', details: `Status: ${response.status}, ACAO: ${acao}` });
  } catch (error) {
    testResults.push({ name: testName, status: 'fail', details: error.message });
    throw error;
  }
}

async function testCORSDeny() {
  log('\n📋 Test 2: CORS Deny (Blocked Origin)', 'blue');
  const testName = '2. CORS Deny (Blocked Origin)';
  
  try {
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
    testResults.push({ name: testName, status: 'pass', details: `Status: ${response.status}, ACAO: ${acao}` });
  } catch (error) {
    testResults.push({ name: testName, status: 'fail', details: error.message });
    throw error;
  }
}

async function testInputValidationSiteId() {
  log('\n📋 Test 3: Input Validation - Invalid site_id', 'blue');
  const testName = '3. Input Validation - Invalid site_id';
  
  try {
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
    testResults.push({ name: testName, status: 'pass', details: `Status: ${response.status}, Message: ${data.message}` });
  } catch (error) {
    testResults.push({ name: testName, status: 'fail', details: error.message });
    throw error;
  }
}

async function testInputValidationUrl() {
  log('\n📋 Test 4: Input Validation - Invalid URL', 'blue');
  const testName = '4. Input Validation - Invalid URL';
  
  if (!SITE_ID) {
    log('⚠️  SKIP: SMOKE_SITE_ID not set, skipping URL validation test', 'yellow');
    testResults.push({ name: testName, status: 'skip', details: 'SMOKE_SITE_ID not set' });
    return;
  }
  
  try {
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
    testResults.push({ name: testName, status: 'pass', details: `Status: ${response.status}, Message: ${data.message}` });
  } catch (error) {
    testResults.push({ name: testName, status: 'fail', details: error.message });
    throw error;
  }
}

async function testHappyPath() {
  log('\n📋 Test 5: Happy Path (Valid Request)', 'blue');
  const testName = '5. Happy Path (Valid Request)';
  
  if (!SITE_ID) {
    log('⚠️  SKIP: SMOKE_SITE_ID not set, skipping happy path test', 'yellow');
    testResults.push({ name: testName, status: 'skip', details: 'SMOKE_SITE_ID not set' });
    return;
  }
  
  try {
    // Ensure request body is valid JSON using JSON.stringify
    const requestBody = {
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
    };
    
    const response = await fetch(`${BASE_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': ORIGIN_ALLOWED,
      },
      body: JSON.stringify(requestBody),
    });
    
    // Get raw response text first for debugging
    const rawResponseText = await response.text();
    
    // Assert status code
    if (response.status !== 200) {
      // Save artifact for GitHub Actions
      const artifactPath = saveFailureArtifact('test5-invalid-status', {
        rawResponse: rawResponseText,
        statusCode: response.status,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
      });
      
      log(`   Raw response: ${rawResponseText}`, 'red');
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      assert(false, `Should return 200 for valid request (got ${response.status})`);
    }
    
    // Parse JSON with error handling
    let data;
    try {
      data = JSON.parse(rawResponseText);
    } catch (parseError) {
      // Save artifact for GitHub Actions
      const artifactPath = saveFailureArtifact('test5-json-parse-failed', {
        rawResponse: rawResponseText,
        parseError: parseError.message,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
      });
      
      log(`   Raw response (JSON parse failed): ${rawResponseText}`, 'red');
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      throw new Error(`Failed to parse JSON response: ${parseError.message}. Raw response: ${rawResponseText}`);
    }
    
    // Assert status field
    if (data.status !== 'synced') {
      // Save artifact for GitHub Actions
      const artifactPath = saveFailureArtifact('test5-invalid-status-field', {
        rawResponse: rawResponseText,
        parsedData: data,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
      });
      
      log(`   Raw response: ${rawResponseText}`, 'red');
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      assert(false, `Response should have status: 'synced' (got ${data.status})`);
    }
    
    // Assert score is present (check json.score first, then json?.data?.score as fallback)
    // API contract: score can be null or number, but never undefined
    const score = data.score !== undefined ? data.score : (data?.data?.score !== undefined ? data.data.score : undefined);
    
    if (score === undefined) {
      // Save artifact for GitHub Actions
      const artifactPath = saveFailureArtifact('test5-score-missing', {
        rawResponse: rawResponseText,
        parsedData: data,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
      });
      
      log(`   Raw response: ${rawResponseText}`, 'red');
      log(`   Parsed data: ${JSON.stringify(data, null, 2)}`, 'red');
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      throw new Error(`Score is missing from response. Expected at data.score or data.data.score. Full payload: ${JSON.stringify(data, null, 2)}`);
    }
    
    // Score can be null (on error) or number (on success), but must be defined
    if (score !== null && typeof score !== 'number') {
      const artifactPath = saveFailureArtifact('test5-score-invalid-type', {
        rawResponse: rawResponseText,
        parsedData: data,
        scoreValue: score,
        scoreType: typeof score,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
      });
      
      log(`   Raw response: ${rawResponseText}`, 'red');
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      throw new Error(`Score should be a number or null (got ${typeof score}: ${score}). Full payload: ${JSON.stringify(data, null, 2)}`);
    }
    
    log(`   Response: ${response.status} ${JSON.stringify(data)}`, 'reset');
    // Score can be null (on error) or number (on success) - both are valid
    const scoreDisplay = score === null ? 'null' : score;
    testResults.push({ name: testName, status: 'pass', details: `Status: ${response.status}, Score: ${scoreDisplay}` });
    
    // Self-test: Force failure to validate artifact upload (only if SMOKE_FORCE_FAIL=true)
    if (SMOKE_FORCE_FAIL) {
      log('\n⚠️  FORCED FAILURE MODE: Intentionally failing Test 5 to validate artifact upload', 'yellow');
      
      // Save artifact before forced failure
      const artifactPath = saveFailureArtifact('FORCED_FAIL', {
        rawResponse: 'FORCED',
        parsedData: null,
        requestBody: requestBody,
        timestamp: new Date().toISOString(),
        reason: 'Self-test: Forced failure to validate artifact upload mechanism',
        testStatus: 'passed_before_forced_fail',
        actualResponse: data,
      });
      
      if (artifactPath) {
        log(`   Artifact saved: ${artifactPath}`, 'yellow');
      }
      
      // Intentionally fail
      throw new Error('FORCED FAILURE: Self-test to validate artifact upload on failure');
    }
  } catch (error) {
    testResults.push({ name: testName, status: 'fail', details: error.message });
    throw error;
  }
}

async function runTests() {
  log('🚀 Starting API Smoke Tests', 'blue');
  log(`   Base URL: ${BASE_URL}`, 'reset');
  log(`   Allowed Origin: ${ORIGIN_ALLOWED}`, 'reset');
  log(`   Denied Origin: ${ORIGIN_DENIED}`, 'reset');
  log(`   Site ID: ${SITE_ID ? '✓ Set' : 'NOT SET (some tests will be skipped)'}`, SITE_ID ? 'reset' : 'yellow');
  
  let hasFailures = false;
  
  try {
    await testCORSAllow();
  } catch (error) {
    hasFailures = true;
  }
  
  try {
    await testCORSDeny();
  } catch (error) {
    hasFailures = true;
  }
  
  try {
    await testInputValidationSiteId();
  } catch (error) {
    hasFailures = true;
  }
  
  try {
    await testInputValidationUrl();
  } catch (error) {
    hasFailures = true;
  }
  
  try {
    await testHappyPath();
  } catch (error) {
    hasFailures = true;
  }
  
  // Write GitHub Actions step summary
  writeStepSummary();
  
  if (hasFailures) {
    log('\n❌ Some smoke tests failed!', 'red');
    if (firstFailure) {
      log(`   First failure: ${firstFailure}`, 'red');
    }
    process.exit(1);
  } else {
    const skipped = testResults.filter(t => t.status === 'skip').length;
    if (skipped > 0) {
      log(`\n✅ All smoke tests passed! (${skipped} skipped)`, 'green');
    } else {
      log('\n✅ All smoke tests passed!', 'green');
    }
    process.exit(0);
  }
}

// Run tests
runTests();
