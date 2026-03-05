# Phase 21: Deep Architectural Consensus — State Machine & Recovery

**Context:** Agreement between architecture and implementation on the strict DB-level state machine, operational recovery semantics, and zero-trust database policy.

---

Your feedback just saved the system's backbone. You perfectly caught that fine line between keeping the State Machine **Strict** and allowing for **Operational Recovery** (the FAILED semantics). We are in 100% agreement. Here are the 3 foundational rules we apply while engraving this vision into the DB layer:

## 1. Semantic Integrity: The True Meaning of FAILED

Adding a **FAILED → QUEUED** transition to the DB trigger would be, exactly as you pointed out, breaching the **Strict Ontology** and telling the system: *"Don't fully believe what I call FAILED."* In distributed systems, failures are strictly bifurcated:

- **Transient:** Network drops, rate limits. These cannot be FAILED; by nature, they are **RETRY**.
- **Permanent:** Invalid GCLID, Auth failures. This is genuinely **FAILED** and therefore **Terminal**.

If the system admin (us) wants to resurrect this data via manual intervention, we cannot rewind to QUEUED (that would break the strict ontology). We allow only **FAILED → RETRY** as the manual "defibrillator": the trigger permits this single exit from FAILED so scripts like `oci-requeue-all-failed.mjs` set status to RETRY (and next_retry_at in the past). The DB remains strict: FAILED is terminal for QUEUED; only RETRY is allowed for manual recovery.

## 2. Eventual Consistency and the UPLOADED Paradox

We clearly see that making the **UPLOADED** status terminal would create a **Race Condition** between the Sweep and ACK synchronization.

- **If the webhook returns success:** UPLOADED → COMPLETED  
- **If the webhook stays silent and 48 hours pass:** UPLOADED → COMPLETED_UNVERIFIED  

This structure proves 100% adherence to the **Eventual Consistency** principle. The trigger locks down UPLOADED like a vault, allowing only these two specific exit paths.

## 3. Zero-Trust DB and Legacy Isolation

Thanks to your warning, we realized that if we don't sanitize the potentially dirty data before adding CHECK constraints, PostgreSQL will reject the migration in prod. We added: (1) **Enum guards** at the top for both `offline_conversion_queue.status` and `marketing_signals.dispatch_status` (assert text/varchar; migration fails fast if either is enum); (2) **Queue:** UPDATE to normalize FATAL → FAILED, then CHECK + trigger; (3) **Signals:** UPDATE to set any unknown `dispatch_status` to FAILED, then CHECK + trigger. Queue trigger allows **RETRY → QUEUED** as compat for backoff/cleanup flows that re-queue from RETRY. The database now operates on a **zero-trust policy** towards the application (Node.js) layer.

---

## Conclusion

The database is no longer just a dumb data store; it has become the **absolute Guardian** of OpsMantik's business logic, defending rules at its core and throwing a *Transaction Rolled Back* to protect itself even if a faulty script is executed.

If we are aligned on this depth, we push the SQL and fire up the smoke tests.

---

*Migration: `supabase/migrations/20260305000004_strict_state_machine.sql`*
