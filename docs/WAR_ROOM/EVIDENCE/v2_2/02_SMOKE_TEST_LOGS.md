# Smoke Test Logs - PRO Dashboard v2.2

**Date**: 2026-01-28  
**Test Script**: `scripts/smoke/v2_2_rpc_contract.mjs`  
**Command**: `npm run smoke:v2_2`

---

## Full Test Output

```
🚀 PRO Dashboard Migration v2.2 - RPC Contract Smoke Test

Supabase URL: https://jktpvfbmuoqrtuwbjpwl.supabase.co
Test Site ID: Will fetch first site

📌 Using site: 9772b10d-bd03-49f8-8ee2-54f9cc65d7c0


🧪 Testing get_dashboard_stats...
✅ get_dashboard_stats: PASS

🧪 Testing get_dashboard_timeline...
✅ get_dashboard_timeline: PASS

🧪 Testing get_dashboard_intents...
✅ get_dashboard_intents: PASS

🧪 Testing get_dashboard_breakdown (source)...
✅ get_dashboard_breakdown (source): PASS

🧪 Testing get_dashboard_breakdown (device)...
✅ get_dashboard_breakdown (device): PASS

🧪 Testing get_dashboard_breakdown (city)...
✅ get_dashboard_breakdown (city): PASS

🧪 Testing 6-month range validation...
✅ 6-month range validation: PASS

============================================================
📊 Test Summary
============================================================
✅ Passed: 7
❌ Failed: 0
📈 Total: 7

✅ All tests passed!
```

---

## Test Coverage

### Test 1: get_dashboard_stats
- ✅ RPC call succeeds
- ✅ Returns data object
- ✅ Contains `site_id`, `date_from`, `date_to`
- ✅ All KPI fields present

### Test 2: get_dashboard_timeline
- ✅ RPC call succeeds
- ✅ Returns array
- ✅ Auto-granularity working

### Test 3: get_dashboard_intents
- ✅ RPC call succeeds
- ✅ Returns array
- ✅ Combines calls + conversions

### Test 4-6: get_dashboard_breakdown
- ✅ All dimensions work (source, device, city)
- ✅ Returns array with count and percentage

### Test 7: 6-Month Range Validation
- ✅ Invalid range (> 180 days) throws error
- ✅ Error message clear and descriptive

---

## Test Results Summary

| Test | Status | Notes |
|------|--------|-------|
| get_dashboard_stats | ✅ PASS | All KPIs returned |
| get_dashboard_timeline | ✅ PASS | Auto-granularity working |
| get_dashboard_intents | ✅ PASS | Calls + conversions combined |
| get_dashboard_breakdown (source) | ✅ PASS | Percentage calculated |
| get_dashboard_breakdown (device) | ✅ PASS | Percentage calculated |
| get_dashboard_breakdown (city) | ✅ PASS | Percentage calculated |
| 6-month range validation | ✅ PASS | Error thrown as expected |

**Overall**: ✅ **7/7 TESTS PASSED**

---

**Evidence File**: `smoke_test_logs.txt`  
**Test Script**: `scripts/smoke/v2_2_rpc_contract.mjs`  
**Date**: 2026-01-28
