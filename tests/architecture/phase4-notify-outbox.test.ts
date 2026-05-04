/**
 * Phase 4 guard — f4-notify-outbox.
 *
 * The outbox processor used to run only via a 2-minute cron poll. Phase 4
 * adds a real-time QStash trigger: seal/stage/status routes publish after
 * `enqueuePanelStageOciOutbox` persists `outbox_events` (post-RPC). The cron
 * remains but as a safety net, scheduled less aggressively.
 *
 * Invariants pinned here:
 *   1) The shared `runProcessOutbox` lives in `lib/oci/outbox/process-outbox.ts`
 *      and is imported by both the cron and worker routes.
 *   2) The cron route is a thin wrapper — it does NOT contain a local
 *      `runProcessOutbox` implementation anymore.
 *   3) The worker route at `/api/workers/oci/process-outbox` uses
 *      `requireQstashSignature` (not `requireCronAuth`).
 *   4) `notifyOutboxPending` is called from seal, stage, and intent status routes
 *      after outbox enqueue attempts (panel stage already did this; seal/status
 *      must too because v2 RPCs do not insert outbox rows).
 *   5) The cron schedule in vercel.json is a safety-net frequency (>= 5 min)
 *      — if it drops below that, the real-time path is the one that must
 *      handle the load.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1) Shared processor module exists and exports the expected symbols
// ---------------------------------------------------------------------------
test('lib/oci/outbox/process-outbox.ts exports runProcessOutbox and constants', () => {
  const full = join(ROOT, 'lib/oci/outbox/process-outbox.ts');
  assert.ok(existsSync(full), 'shared processor module must exist');
  const src = readFileSync(full, 'utf8');
  assert.ok(/export async function runProcessOutbox\b/.test(src), 'runProcessOutbox must be exported');
  assert.ok(/export const OUTBOX_BATCH_LIMIT\b/.test(src), 'OUTBOX_BATCH_LIMIT must be exported');
  assert.ok(/export const OUTBOX_MAX_ATTEMPTS\b/.test(src), 'OUTBOX_MAX_ATTEMPTS must be exported');
});

// ---------------------------------------------------------------------------
// 2) Cron route is thin — no local runProcessOutbox
// ---------------------------------------------------------------------------
test('cron route imports shared runProcessOutbox and does not re-implement it', () => {
  const src = readFileSync(
    join(ROOT, 'app/api/cron/oci/process-outbox-events/route.ts'),
    'utf8'
  );
  assert.ok(
    src.includes("from '@/lib/oci/outbox/process-outbox'"),
    'cron route must import from the shared module'
  );
  assert.ok(src.includes('runProcessOutbox'), 'cron route must call runProcessOutbox');
  assert.ok(
    !/^(async )?function runProcessOutbox\b/m.test(src),
    'cron route must not re-declare runProcessOutbox locally'
  );
  // Body must stay thin. 100 lines is generous for an auth gate + response mapper.
  const lines = src.split(/\r?\n/).length;
  assert.ok(lines <= 100, `cron route has grown to ${lines} lines — keep it a thin wrapper`);
});

// ---------------------------------------------------------------------------
// 3) Worker route exists and is QStash-signed
// ---------------------------------------------------------------------------
test('worker route at /api/workers/oci/process-outbox exists and is QStash-signed', () => {
  const full = join(ROOT, 'app/api/workers/oci/process-outbox/route.ts');
  assert.ok(existsSync(full), 'worker route must exist');
  const src = readFileSync(full, 'utf8');
  assert.ok(
    src.includes("from '@/lib/qstash/require-signature'"),
    'worker must import requireQstashSignature'
  );
  assert.ok(/requireQstashSignature\(/.test(src), 'worker must wrap handler with requireQstashSignature');
  assert.ok(
    !src.includes("from '@/lib/cron/require-cron-auth'"),
    'worker must NOT use cron auth — QStash auth only'
  );
  assert.ok(
    src.includes("from '@/lib/oci/outbox/process-outbox'"),
    'worker must import shared runProcessOutbox'
  );
});

// ---------------------------------------------------------------------------
// 4) Notify helper exists and is wired into seal + stage routes
// ---------------------------------------------------------------------------
test('notifyOutboxPending helper exists', () => {
  const full = join(ROOT, 'lib/oci/notify-outbox.ts');
  assert.ok(existsSync(full), 'notify helper must exist');
  const src = readFileSync(full, 'utf8');
  assert.ok(
    /export async function notifyOutboxPending\b/.test(src),
    'notifyOutboxPending must be an async exported function'
  );
  assert.ok(
    /export function resolveOutboxWorkerUrl\b/.test(src),
    'resolveOutboxWorkerUrl must be exported for tests/ops tooling'
  );
  assert.ok(
    src.includes('/api/workers/oci/process-outbox'),
    'notify helper must target the worker URL'
  );
  assert.ok(
    /deduplicationId/.test(src),
    'notify helper must pass a deduplicationId to coalesce bursts'
  );
});

test('seal route enqueues IntentSealed + fires notifyOutboxPending after apply_call_action_v2', () => {
  const src = readFileSync(
    join(ROOT, 'app/api/calls/[id]/seal/route.ts'),
    'utf8'
  );
  assert.ok(
    src.includes("from '@/lib/oci/notify-outbox'"),
    'seal route must import notifyOutboxPending'
  );
  assert.ok(
    src.includes('enqueuePanelStageOciOutbox'),
    'seal route must insert outbox rows (apply_call_action_v2 does not write outbox internally)'
  );
  // Probe + bearer paths both call it.
  const calls = src.match(/notifyOutboxPending\(/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `seal route must call notifyOutboxPending from both probe and bearer paths (found ${calls.length})`
  );
  assert.ok(src.includes('oci_reconciliation_reason'), 'seal route must expose oci_reconciliation_reason');
  assert.ok(src.includes('oci_enqueue_ok'), 'seal route must expose oci_enqueue_ok');
});

test('stage route enqueues IntentSealed + fires notifyOutboxPending after panel RPC', () => {
  const src = readFileSync(
    join(ROOT, 'app/api/intents/[id]/stage/route.ts'),
    'utf8'
  );
  assert.ok(
    src.includes("from '@/lib/oci/notify-outbox'"),
    'stage route must import notifyOutboxPending'
  );
  assert.ok(src.includes('enqueuePanelStageOciOutbox'), 'stage route must insert outbox after RPC success');
  assert.ok(
    /notifyOutboxPending\(/.test(src),
    'stage route must call notifyOutboxPending'
  );
  assert.ok(src.includes('oci_reconciliation_reason'), 'stage route must expose oci_reconciliation_reason');
  assert.ok(src.includes('oci_enqueue_ok'), 'stage route must expose oci_enqueue_ok');
});

test('intent status route enqueues IntentSealed + fires notifyOutboxPending', () => {
  const src = readFileSync(join(ROOT, 'app/api/intents/[id]/status/route.ts'), 'utf8');
  assert.ok(src.includes('enqueuePanelStageOciOutbox'), 'status route must insert outbox after RPC success');
  assert.ok(/notifyOutboxPending\(/.test(src), 'status route must notify outbox processor');
  assert.ok(src.includes('oci_reconciliation_reason'), 'status route must expose oci_reconciliation_reason');
  assert.ok(src.includes('oci_enqueue_ok'), 'status route must expose oci_enqueue_ok');
});

// ---------------------------------------------------------------------------
// 5) Cron schedule is a safety-net frequency, not the hot path
// ---------------------------------------------------------------------------
test('vercel.json schedules the outbox cron at a safety-net frequency', () => {
  const vercel = JSON.parse(
    readFileSync(join(ROOT, 'vercel.json'), 'utf8')
  ) as { crons: Array<{ path: string; schedule: string }> };
  const cron = vercel.crons.find((c) => c.path === '/api/cron/oci/process-outbox-events');
  assert.ok(cron, 'outbox cron must be scheduled in vercel.json');
  // Parse the minute spec like */5 — accept any integer >= 5.
  const m = cron!.schedule.match(/^\*\/(\d+)\s/);
  assert.ok(m, `unexpected cron schedule shape: ${cron!.schedule}`);
  const minutes = Number(m![1]);
  assert.ok(
    minutes >= 5,
    `outbox cron schedule every ${minutes} min is too aggressive — real-time trigger should handle the hot path (safety net ≥ 5 min)`
  );
});
