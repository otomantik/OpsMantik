# Load Testing

Load tests for OpsMantik using [k6](https://k6.io/).

## Prerequisites

**Option 1: npx (recommended)**
```bash
# No installation needed
npx k6 run tests/load/smoke-load.js
```

**Option 2: Install k6**
```bash
# macOS
brew install k6

# Windows (via Chocolatey)
choco install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Option 3: Docker**
```bash
docker run --rm -i grafana/k6 run - < tests/load/smoke-load.js
```

## Available Tests

### `smoke-load.js` - Basic Stability Test
**Purpose:** Verify system can handle moderate concurrent load without errors.

**Scenario:**
- 50 virtual users
- Ramp up: 1 minute
- Sustained: 2 minutes
- Ramp down: 30 seconds
- Target: `POST /api/sync`

**Success criteria:**
- Error rate < 1%
- p95 latency < 500ms
- No 500 errors

**Run:**
```bash
# Local development
npx k6 run tests/load/smoke-load.js

# Against staging
BASE_URL=https://staging.opsmantik.com npx k6 run tests/load/smoke-load.js

# Against production (use carefully, with test site)
BASE_URL=https://console.opsmantik.com TEST_SITE_ID=test_site_5186339e npx k6 run tests/load/smoke-load.js
```

## Interpreting Results

k6 outputs metrics at the end of each test:

```
✓ status is 200                  ........ 100.00% ✓ 8432      ✗ 0     
✓ response has ok field          ........ 100.00% ✓ 8432      ✗ 0     
✓ response time < 1s             ........ 100.00% ✓ 8432      ✗ 0     

checks.........................: 100.00% ✓ 25296     ✗ 0     
http_req_duration..............: avg=125ms  p(95)=287ms
http_req_failed................: 0.00%   ✓ 0         ✗ 8432  
```

**Key metrics:**
- `checks`: All assertions passed (aim for 100%)
- `http_req_duration`: Response time distribution
  - `avg`: average
  - `p(95)`: 95th percentile (threshold: <500ms)
- `http_req_failed`: Error rate (aim for <1%)

## When to Run

**Before production deploy:**
```bash
# Smoke test against staging
BASE_URL=https://staging.opsmantik.com npx k6 run tests/load/smoke-load.js
```

**After critical changes:**
- Rate limiting changes
- Database schema migrations
- API endpoint refactors
- Infrastructure changes

**Regular schedule:**
- Weekly: smoke load test
- Monthly: stress test (higher load, longer duration)

## Creating New Tests

Copy `smoke-load.js` and adjust:
- `options.stages` for different load patterns
- `thresholds` for different success criteria
- Payload for different endpoints

Example stress test:
```javascript
export const options = {
  stages: [
    { duration: '2m', target: 200 },   // Ramp to 200 users
    { duration: '5m', target: 200 },   // Sustain 200 users
    { duration: '2m', target: 500 },   // Spike to 500
    { duration: '5m', target: 500 },   // Sustain spike
    { duration: '2m', target: 0 },     // Ramp down
  ],
};
```

## Troubleshooting

**"dial tcp: lookup localhost: no such host"**
- Set `BASE_URL=http://127.0.0.1:3000`

**High error rate (>1%)**
- Check rate limiting configuration
- Verify test site exists in DB
- Check CORS allowlist includes test origin

**High latency (p95 > 500ms)**
- Profile slow database queries
- Check if Supabase connection pool saturated
- Verify Redis/Upstash connectivity
