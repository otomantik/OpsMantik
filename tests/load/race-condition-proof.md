# Race Condition Validation — Call-Event

**Objective:** Prove that 5 identical call-events sent in the same millisecond produce exactly 1 billable event and no duplicate inserts.

---

## Proof Steps

### 1. Preconditions
- `SITE_ID`, `SECRET` (call-event signing) available
- `BASE_URL` (e.g. https://console.opsmantik.com or staging)
- Database access to verify row counts (optional but recommended)

### 2. Create Signed Payload (Once)
```bash
# Node one-liner to generate signed request (same payload for all 5)
node -e "
const crypto = require('crypto');
const SITE_ID = process.env.SITE_ID;
const SECRET = process.env.SECRET;
const payload = { site_id: SITE_ID, fingerprint: 'fp_race_proof_' + Date.now(), phone_number: null };
const rawBody = JSON.stringify(payload);
const ts = Math.floor(Date.now()/1000);
const sig = crypto.createHmac('sha256', SECRET).update(ts + '.' + rawBody, 'utf8').digest('hex');
console.log(JSON.stringify({ body: rawBody, ts, sig }));
"
```

### 3. Fire 5 Concurrent Requests
Use GNU parallel, xargs, or a small script to POST the **exact same** body and headers 5 times in parallel:

```bash
# Save output from step 2 to vars, then:
for i in 1 2 3 4 5; do
  curl -s -X POST "$BASE_URL/api/call-event/v2" \
    -H "Content-Type: application/json" \
    -H "x-ops-site-id: $SITE_ID" \
    -H "x-ops-ts: $TS" \
    -H "x-ops-signature: $SIG" \
    -d "$BODY" &
done
wait
```

Or use k6:
```javascript
// 5 VUs, same payload, start simultaneously
export const options = { vus: 5, duration: '1s', startTime: '0s' };
export function setup() { return buildSignedPayload(); }
export default function (data) { http.post(url, data.body, { headers: data.headers }); }
```

### 4. Confirm Results

| Check | Expected | How to Verify |
|-------|----------|---------------|
| Only 1 billable event | 1 call row for that fingerprint | `SELECT COUNT(*) FROM calls WHERE matched_fingerprint = 'fp_race_proof_...'` |
| Idempotency row count | 1 (call-event path may not use idempotency table; replay handles dedup) | Replay returns 200 noop for 4 of 5 |
| No duplicate charge | N/A for call-event (no direct charge) | No duplicate calls rows |
| No OCI duplicate enqueue | 0 or 1 queue rows for that call | `SELECT COUNT(*) FROM offline_conversion_queue WHERE ...` |

### 5. Response Distribution
- 1× request: 200 (insert) or 204 (no session) — first to pass replay
- 4× requests: 200 + `status: "noop"` — replay cache hit

### 6. PASS Criteria
- Exactly 1 call row (or 0 if no matching session) for the fingerprint
- Exactly 4 responses with `status: "noop"`
- No duplicate inserts; no 500 errors
