/**
 * PR-1 — Queue lifecycle contract pins (docs + runtime anchors).
 * @see docs/architecture/OCI_QUEUE_LIFECYCLE_CONTRACT.md
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walkTsFiles(p, acc);
    } else if (
      st.isFile() &&
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.spec.ts')
    ) {
      acc.push(p);
    }
  }
  return acc;
}

test('OCI_QUEUE_LIFECYCLE_CONTRACT.md exists and pins core transition headings', () => {
  const mdPath = join(process.cwd(), 'docs', 'architecture', 'OCI_QUEUE_LIFECYCLE_CONTRACT.md');
  const md = readFileSync(mdPath, 'utf8');
  assert.ok(md.includes('## 3. Allowed transitions'));
  assert.ok(md.includes('## 4. Forbidden transitions'));
  assert.ok(md.includes('## 5. `COMPLETED` semantics'));
  assert.ok(md.includes('## 9. Approved transition writers'));
  for (const line of [
    '| `QUEUED` | `PROCESSING` |',
    '| `PROCESSING` | `COMPLETED` |',
    '| `PROCESSING` | `RETRY` |',
    '| `FAILED` → `COMPLETED` |',
    '| `QUEUED` / `RETRY` → `COMPLETED` without `PROCESSING` + ACK family |',
  ]) {
    assert.ok(md.includes(line), `contract must mention: ${line}`);
  }
});

test('invalidatePendingOciArtifactsForCall uses worker batch RPC (ledger-safe)', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'invalidate-pending-artifacts.ts'), 'utf8');
  assert.ok(src.includes('append_worker_transition_batch_v2'), 'must use append_worker_transition_batch_v2');
  assert.ok(
    !/from\(\s*['']offline_conversion_queue['']\s*\)\s*\.update/.test(src),
    'must not direct-update offline_conversion_queue'
  );
});

test('ACK routes use script transition RPC + receipt registration', () => {
  const ack = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  assert.ok(ack.includes('registerAckReceipt'), 'ack must register receipt');
  assert.ok(ack.includes('append_script_transition_batch'), 'ack must use append_script_transition_batch');
  const failed = readFileSync(join(process.cwd(), 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  assert.ok(failed.includes('registerAckReceipt'), 'ack-failed must register receipt');
  assert.ok(failed.includes('append_script_transition_batch'), 'ack-failed must use append_script_transition_batch');
});

test('export mark-processing uses claim + script transition batch', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  assert.ok(src.includes('append_script_claim_transition_batch'), 'export claim must use script claim RPC');
  assert.ok(src.includes('append_script_transition_batch'), 'export finalize must use script batch RPC');
});

test('PR-1B: SUPPRESSED_BY_HIGHER_GEAR terminalizes as FAILED (not COMPLETED / no fake Google success)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  assert.ok(src.includes('SUPPRESSED_BY_HIGHER_GEAR'), 'suppression must retain provenance code');
  assert.ok(
    src.includes('claimAndFinalizeQueue') && src.includes('built.suppressedQueueIds'),
    'suppression must use same deterministic-skip finalizer as other export skips'
  );
  assert.ok(
    !/suppressedQueueIds[\s\S]{0,800}p_new_status:\s*['']COMPLETED['']/.test(src),
    'suppressed rows must never be forced to COMPLETED without ACK'
  );
  const md = readFileSync(join(process.cwd(), 'docs', 'architecture', 'OCI_QUEUE_LIFECYCLE_CONTRACT.md'), 'utf8');
  assert.ok(
    md.includes('SUPPRESSED_BY_HIGHER_GEAR') &&
      md.includes('not** successful Google conversions') &&
      md.includes('## PR-1B'),
    'lifecycle doc must classify suppression as non-upload terminal'
  );
});

test('PR-1C: OCI_QUEUE_HEALTH documents FAILED vs provider failure and actionable rate gates', () => {
  const md = readFileSync(join(process.cwd(), 'docs', 'architecture', 'OCI_QUEUE_HEALTH.md'), 'utf8');
  assert.ok(md.includes('PR-1C'));
  assert.ok(md.includes('actionable_failed_rate') && md.includes('provider_failed_rate'));
  assert.ok(md.includes('DETERMINISTIC_SKIP') || md.includes('deterministic'));
  assert.ok(md.includes('unknown_failed_count'));
});

test('PR-1C: hardening runbook notes historical COMPLETED + suppression mismatch', () => {
  const md = readFileSync(join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'), 'utf8');
  assert.ok(md.includes('Historical rows'));
  assert.ok(md.includes('SUPPRESSED_BY_HIGHER_GEAR') && md.includes('--write'));
});

test('PR-4: docs ban blind retry for provider-ambiguous PROCESSING', () => {
  const runbook = readFileSync(join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'), 'utf8');
  const healthDoc = readFileSync(join(process.cwd(), 'docs', 'architecture', 'OCI_QUEUE_HEALTH.md'), 'utf8');
  assert.ok(runbook.includes('Do **not** blindly move stale `PROCESSING` rows to `RETRY`'));
  assert.ok(runbook.includes('ACK_ENDPOINT_UNAVAILABLE_AFTER_UPLOAD'));
  assert.ok(healthDoc.includes('provider-outcome aware'));
  assert.ok(healthDoc.includes('duplicate upload risk'));
});

test('PR-4D: docs mention classifier mode flag and rollback by disable', () => {
  const runbook = readFileSync(join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md'), 'utf8');
  assert.ok(runbook.includes('OCI_PROCESSING_RECOVERY_CLASSIFIER_MODE'));
  assert.ok(runbook.includes('Rollback is flag disable'));
  assert.ok(runbook.includes('OCI_RECOVERY_INTEGRITY_STRICT=0'));
});

test('PR-4: no queue row deletion introduced in recovery paths', () => {
  const recoverRoute = readFileSync(
    join(process.cwd(), 'app', 'api', 'cron', 'providers', 'recover-processing', 'route.ts'),
    'utf8'
  );
  const maintenance = readFileSync(join(process.cwd(), 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(recoverRoute));
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(maintenance));
});

test('PR-1B: queue health failed_rate treats FAILED (+DLQ) as unreliable — not conflated with COMPLETED', () => {
  const healthSrc = readFileSync(join(process.cwd(), 'lib', 'oci', 'queue-health-contract.ts'), 'utf8');
  assert.ok(
    healthSrc.includes('failed_rate') && healthSrc.includes('failedCount') && healthSrc.includes('deadLetterQuarantineCount'),
    'health contract must derive failed_rate from FAILED+DLQ, not from suppression-as-COMPLETED'
  );
});

test('app/ and lib/: no direct .from(offline_conversion_queue).update chains', () => {
  const re = /\.from\(\s*['']offline_conversion_queue['']\s*\)\s*\n\s*\.update\(/m;
  const roots = [join(process.cwd(), 'app'), join(process.cwd(), 'lib')];
  const violations: string[] = [];
  for (const root of roots) {
    for (const file of walkTsFiles(root)) {
      const body = readFileSync(file, 'utf8');
      if (re.test(body)) {
        violations.push(file.replace(process.cwd() + '/', ''));
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Direct offline_conversion_queue updates must not exist under app/ or lib/: ${violations.join(', ')}`
  );
});
