/**
 * OpsMantik Load Test - Smoke Test
 * 
 * Purpose: Verify system stability under moderate concurrent load.
 * 
 * Scenario:
 * - 50 virtual users ramp up over 1 minute
 * - Each VU makes repeated requests to POST /api/sync
 * - Validates 200 OK responses
 * - Checks p95 latency < 500ms
 * 
 * How to run:
 * 
 *   # Via npx (no install needed):
 *   npx k6 run tests/load/smoke-load.js
 * 
 *   # Via Docker:
 *   docker run --rm -i grafana/k6 run - < tests/load/smoke-load.js
 * 
 *   # With custom target (default: http://localhost:3000):
 *   BASE_URL=https://console.opsmantik.com npx k6 run tests/load/smoke-load.js
 * 
 * Success criteria:
 * - http_req_failed < 1% (at least 99% success rate)
 * - http_req_duration (p95) < 500ms
 * - No 500 errors
 * 
 * Note: This is a "smoke load" test, not a stress test.
 * For stress testing, increase vus to 500+ and duration to 10m.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const syncDuration = new Trend('sync_duration');

// Load test configuration
export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users over 1 minute
    { duration: '2m', target: 50 },   // Stay at 50 users for 2 minutes
    { duration: '30s', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    'http_req_failed': ['rate<0.01'],        // < 1% error rate
    'http_req_duration': ['p(95)<500'],      // p95 < 500ms
    'http_req_duration{type:sync}': ['p(95)<500'],
    'errors': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Test site ID (use a test/staging site, not production)
const TEST_SITE_ID = __ENV.TEST_SITE_ID || 'test_site_5186339e';

export default function () {
  // Generate a realistic session fingerprint
  const sessionId = `load_test_${__VU}_${Date.now()}`;
  const fingerprint = `fp_${sessionId}`;

  // Create a valid /api/sync payload (mimics tracker behavior)
  const payload = {
    s: TEST_SITE_ID,                    // site_id
    url: `https://example.com/page-${__VU}`,  // page URL
    r: 'https://google.com',             // referrer
    meta: {
      fingerprint: fingerprint,
      s: sessionId,                      // session ID
      t: 'pageview',                     // event type
      cat: 'interaction',
      act: 'view',
      lab: 'Load Test Page',
    },
  };

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://example.com',
      'User-Agent': 'k6-load-test/1.0',
    },
    tags: { type: 'sync' },
  };

  // Make request
  const response = http.post(
    `${BASE_URL}/api/sync`,
    JSON.stringify(payload),
    params
  );

  // Validate response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response has ok field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 1s': (r) => r.timings.duration < 1000,
  });

  // Track errors and duration
  errorRate.add(!success);
  syncDuration.add(response.timings.duration);

  // Throttle: wait 1-3 seconds between requests (realistic user behavior)
  sleep(Math.random() * 2 + 1);
}

/**
 * Teardown function (runs once after all VUs finish)
 */
export function handleSummary(data) {
  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
