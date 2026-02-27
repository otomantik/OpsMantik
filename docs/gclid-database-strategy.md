# ARCHITECTURAL STRATEGY: Click ID Database Schema & OCI Deduplication

**Status**: PROPOSED  
**Principal Architect**: Antigravity  
**Context**: Enterprise OCI Pipeline (iOS 14+ Compliance)

---

## 1. Schema Design: Separate vs. Unified Click ID

### The Verdict: **Separate Columns (Explicit Schema)**
While a unified `click_id` + `click_id_type` sounds flexible, it introduces significant friction in ORM mapping and SQL indexing.

**Proposed Implementation:**
- `gclid` (TEXT)
- `wbraid` (TEXT)
- `gbraid` (TEXT)

**Why?**
- **iOS 14+ Dilemma**: WBRAID and GBRAID were introduced to handle ATT (App Tracking Transparency). They are aggregate IDs. By keeping them separate, we can easily run "Coverage Audits" (e.g., *What percentage of our traffic is WBRAID vs GCLID?*).
- **API vs. Scripts**: 
    - **Google Ads API**: Fully supports all three. A `ConversionUpload` object has explicit fields for each.
    - **Scripts**: Many legacy OCI scripts **strictly** require GCLID. Using separate columns allows the exporter to easily filter out records that the target sync method doesn't support.

---

## 2. Deduplication & The "Multi-Action" User

### The "Conversion Action" Granularity
The Google Ads API deduplicates based on the tuple: `(ClickID, ConversionAction, ConversionTime)`. If the `ConversionTime` differs by even 1 second, Google may record two conversions.

**The Multi-Action Guard:**
We must implement a **Submission Lock** at the application level to prevent spamming the API.
- **Database Constraint**: A `UNIQUE` index on `offline_conversion_queue (call_id, conversion_action)`.
- **Logic**: If a user clicks 'WhatsApp' 3 times, each event is recorded in our `events` table, but the **OCI Enqueue Logic** will only allow the *first* event for that `callId` + `ConversionAction` ('WhatsApp') to enter the queue.

---

## 3. Indexing for High-Velocity OCI Workers

To ensure the `QStash` workers don't crawl, we require composite indexes that mirror the worker's query patterns.

**Required Indexes (Public.calls / Public.sessions):**
1. **The Join Optimizer**: `idx_sessions_click_coverage` on `(site_id, gclid, wbraid, gbraid)`.
2. **The Worker Scanner**: `idx_calls_oci_lookup` on `(status, site_id)` WHERE `status IN ('pending', 'qualified')`.
3. **The Dedup Guard**: `idx_oci_queue_dedup` on `offline_conversion_queue (call_id, provider_key)`.

---

## 4. Data Hygiene: Organic vs. Paid

**The "Ghost" Lead Strategy**:
We do **not** need separate tables for organic leads. Organic leads are simply leads where all click ID columns are `NULL`.

**Hygiene Rules:**
- **Source Attribute**: The `calls` table should have a `source_type` ('paid', 'organic', 'direct').
- **Query Filtering**: Use `WHERE gclid IS NOT NULL OR wbraid IS NOT NULL OR gbraid IS NOT NULL` to isolate paid traffic for OCI export logic.
- **Null Handling**: Ensure the `calculateExpectedValue` and `calculateBrainScore` utility functions are resilient to missing click IDs (which they already are).

---

## 5. Timeline: From Click to Upload

| Time | Layer | Action |
| :--- | :--- | :--- |
| **T=0** | Frontend | Capture `gclid/wbraid/gbraid` from URL. Store in `localStorage`. |
| **T+10s** | Ingest | Lead arrives. Session is matched. Click ID is stored in `sessions`. |
| **T+1m** | Score | Brain Score evaluates lead. High-score leads are marked `fast_track`. |
| **T+5m** | Queue | OCI logic checks for existing queue entry. If unique, inserts with `status='QUEUED'`. |
| **T+Nightly** | Worker | OCI Worker claims batch, calls Google API, moves to `synced`. |

---

**Approval Required**: Please review the decision for **Separate Columns**. If you prefer a polymorphic `click_id` column, we can pivot, but explicit columns are the standard for high-fidelity AdTech systems.
