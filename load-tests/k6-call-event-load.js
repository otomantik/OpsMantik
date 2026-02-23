/**
 * OpsMantik — Call-Event Load Test (Sprint A: Operational Proof)
 *
 * Simulates 5 minutes of mixed traffic:
 * - 40% normal valid call-event
 * - 30% replay spam (identical signed payload)
 * - 20% fingerprint brute attempts (pool of fps, no session)
 * - 10% invalid signature attempts
 *
 * Assertions:
 * - No 500 flood
 * - Replay returns 200 + status:"noop"
 * - Invalid signature rejected (401)
 * - Fingerprint brute hits rate-limit (429)
 * - No duplicate inserts (verify via replay noop count)
 *
 * Env:
 *   BASE_URL (default: http://localhost:3000)
 *   SITE_ID (required)
 *   SECRET (required; call-event signing secret)
 *   RPS (optional; default 10. WARNING: 50 rps exceeds 150/min site limit; expect 429s)
 *
 * Run: k6 run load-tests/k6-call-event-load.js
 * Prod: BASE_URL=https://console.opsmantik.com SITE_ID=xxx SECRET=xxx k6 run load-tests/k6-call-event-load.js
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SITE_ID = __ENV.SITE_ID || '';
const SECRET = __ENV.SECRET || '';
const RPS_TARGET = parseInt(__ENV.RPS || '10', 10);
const DURATION = '5m';

const errorRate = new Rate('errors');
const status200 = new Rate('status_200');
const status204 = new Rate('status_204');
const status400 = new Rate('status_400');
const status401 = new Rate('status_401');
const status429 = new Rate('status_429');
const status500 = new Rate('status_500');
const latency = new Trend('http_req_duration_call_event');

function hmacHex(secret, message) {
  return crypto.hmac('sha256', secret, message, 'hex');
}

function buildSignedRequest(payload, useInvalidSig = false) {
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = useInvalidSig ? '0'.repeat(64) : hmacHex(SECRET, `${ts}.${rawBody}`);
  return {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'x-ops-site-id': SITE_ID,
      'x-ops-ts': String(ts),
      'x-ops-signature': sig,
    },
  };
}

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: 'constant-arrival-rate',
      rate: RPS_TARGET,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    'status_500': ['rate<0.01'],
    'errors': ['rate<0.15'],
  },
};

const FP_POOL_SIZE = 8;
const fpPool = [];
for (let i = 0; i < FP_POOL_SIZE; i++) {
  fpPool.push(`fp_brute_${i}`);
}

export function setup() {
  if (!SITE_ID || !SECRET) return {};
  const payload = { site_id: SITE_ID, fingerprint: 'fp_replay_load_test', phone_number: null };
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = hmacHex(SECRET, `${ts}.${rawBody}`);
  return {
    replayBody: rawBody,
    replayHeaders: {
      'Content-Type': 'application/json',
      'x-ops-site-id': SITE_ID,
      'x-ops-ts': String(ts),
      'x-ops-signature': sig,
    },
  };
}

export default function k6CallEventLoad(data = {}) {
  if (!SITE_ID || !SECRET) {
    console.error('SITE_ID and SECRET required');
    return;
  }

  const r = Math.random();
  let type, payload, useInvalidSig = false;

  if (r < 0.4) {
    type = 'normal';
    payload = { site_id: SITE_ID, fingerprint: `fp_normal_${__VU}_${Date.now()}`, phone_number: null };
  } else if (r < 0.7 && data && data.replayBody) {
    type = 'replay';
  } else if (r < 0.9) {
    type = 'fp_brute';
    const fp = fpPool[Math.floor(Math.random() * fpPool.length)];
    payload = { site_id: SITE_ID, fingerprint: fp, phone_number: null };
  } else {
    type = 'invalid_sig';
    payload = { site_id: SITE_ID, fingerprint: `fp_invalid_${Date.now()}`, phone_number: null };
    useInvalidSig = true;
  }

  let body, headers;
  if (type === 'replay' && data && data.replayBody) {
    body = data.replayBody;
    headers = data.replayHeaders;
  } else {
    const req = buildSignedRequest(payload, useInvalidSig);
    body = req.body;
    headers = req.headers;
  }

  const res = http.post(`${BASE_URL}/api/call-event/v2`, body, {
    headers,
    tags: { type },
  });

  latency.add(res.timings.duration);

  if (res.status === 200) status200.add(1); else status200.add(0);
  if (res.status === 204) status204.add(1); else status204.add(0);
  if (res.status === 400) status400.add(1); else status400.add(0);
  if (res.status === 401) status401.add(1); else status401.add(0);
  if (res.status === 429) status429.add(1); else status429.add(0);
  if (res.status >= 500) status500.add(1); else status500.add(0);

  let success = true;
  if (type === 'replay') {
    success = res.status === 200;
    if (success) {
      try {
        const body = JSON.parse(res.body);
        success = body && body.status === 'noop';
      } catch {
        success = false;
      }
    }
  } else if (type === 'invalid_sig') {
    success = res.status === 401;
  } else if (type === 'fp_brute') {
    success = res.status === 204 || res.status === 429;
  } else {
    success = res.status === 200 || res.status === 204;
  }
  errorRate.add(!success);

  sleep(0.02);
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count || 0;
  const failed = data.metrics.http_req_failed?.values?.rate || 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] || 0;
  const s200 = data.metrics.status_200?.values?.rate || 0;
  const s204 = data.metrics.status_204?.values?.rate || 0;
  const s401 = data.metrics.status_401?.values?.rate || 0;
  const s429 = data.metrics.status_429?.values?.rate || 0;
  const s500 = data.metrics.status_500?.values?.rate || 0;

  return {
    stdout: `
=== Call-Event Load Test Summary ===
Total requests: ${total}
Success rate: ${((1 - failed) * 100).toFixed(2)}%
Error rate: ${(failed * 100).toFixed(2)}%
Latency p95: ${(p95 / 1000).toFixed(2)}s

Response distribution:
  200: ${(s200 * 100).toFixed(1)}%
  204: ${(s204 * 100).toFixed(1)}%
  400: ${((data.metrics.status_400?.values?.rate || 0) * 100).toFixed(1)}%
  401: ${(s401 * 100).toFixed(1)}%
  429: ${(s429 * 100).toFixed(1)}%
  500: ${(s500 * 100).toFixed(1)}%

PASS criteria:
  - 500 rate < 1%: ${s500 < 0.01 ? 'PASS' : 'FAIL'}
  - Replay returns 200 noop: (check replay scenario)
  - Invalid sig returns 401: (check invalid_sig scenario)
  - Fingerprint brute 429 or 204: (check fp_brute scenario)

CPU observation: Monitor host CPU during test. No runaway = CPU stable after ramp. Use top/htop or Vercel logs.
`,
  };
}
