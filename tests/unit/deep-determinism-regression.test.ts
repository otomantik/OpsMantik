import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const INTENT_STATUS_ROUTE = join(ROOT, 'app', 'api', 'intents', '[id]', 'status', 'route.ts');
const ACK_ROUTE = join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts');
const ACK_FAILED_ROUTE = join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts');
const OCI_EXPORT_ROUTE = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
const PROCESS_OUTBOX_ROUTE = join(ROOT, 'app', 'api', 'cron', 'oci', 'process-outbox-events', 'route.ts');
const SWEEP_ZOMBIES_ROUTE = join(ROOT, 'app', 'api', 'cron', 'oci', 'sweep-zombies', 'route.ts');
const PROCESS_CALL_EVENT = join(ROOT, 'lib', 'ingest', 'process-call-event.ts');
const INTENT_QUALIFICATION = join(ROOT, 'lib', 'hooks', 'use-intent-qualification.ts');
const CRON_AUTH = join(ROOT, 'lib', 'cron', 'require-cron-auth.ts');
const RUNNER = join(ROOT, 'lib', 'oci', 'runner.ts');
const TRACKER = join(ROOT, 'lib', 'tracker', 'tracker.js');
const ACTIVITY_LOG = join(ROOT, 'components', 'dashboard', 'qualification-queue', 'activity-log-inline.tsx');
const STAGE_ROUTE = join(ROOT, 'app', 'api', 'calls', '[id]', 'stage', 'route.ts');
const SCRIPT_BATCH_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261105070000_phase23c_script_terminal_batch_atomic.sql');
const WORKER_BATCH_V2_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261105100000_phase23c_outbox_and_worker_batch_v2.sql');
const OCI_HARDENING_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261105130000_oci_external_id_and_reversal_void.sql');

test('intent status route: restore goes through undo_last_action_v1 with system actor under service role', () => {
  const src = readFileSync(INTENT_STATUS_ROUTE, 'utf8');
  assert.ok(src.includes("const rpcName = actionType === 'restore' ? 'undo_last_action_v1' : 'apply_call_action_v1'"), 'restore must use undo_last_action_v1');
  assert.ok(src.includes("p_actor_type: 'system'"), 'manual queue actions must use normalized system actor under adminClient RPC');
  assert.ok(src.includes('p_actor_id: user.id'), 'manual queue actions must preserve the human actor id for audit lineage');
  assert.ok(src.includes('invalidatePendingOciArtifactsForCall'), 'restore/cancel/junk must invalidate pending OCI artifacts');
});

test('call action rpc lineage: system actors are normalized before call_actions append', () => {
  const migrationPath = join(ROOT, 'supabase', 'migrations', '20261106190000_call_action_actor_normalization.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes("v_actor_type := 'system';"), 'non-user actors must normalize to system');
  assert.ok(src.includes('INSERT INTO public.call_actions') && src.includes('v_actor_type'), 'normalized actor_type must be appended to call_actions');
});

test('single-head cleanup: call sale review is DB-owned and stage shadow route is retired', () => {
  const migrationPath = join(ROOT, 'supabase', 'migrations', '20261106200000_single_head_rpc_unification.sql');
  const migrationSrc = readFileSync(migrationPath, 'utf8');
  const stageSrc = readFileSync(STAGE_ROUTE, 'utf8');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.review_call_sale_time_v1'), 'cleanup migration must define review_call_sale_time_v1');
  assert.ok(migrationSrc.includes('INSERT INTO public.outbox_events'), 'review rpc must emit outbox rows transactionally');
  assert.ok(stageSrc.includes('PIPELINE_STAGE_ROUTE_RETIRED'), 'stage route must be explicitly retired');
});

test('call-event ingestion sanitizes click ids before paid classification', () => {
  const src = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(src.includes('const sanitizedGclid = sanitizeClickId(payload.gclid) ?? sanitizedClickId;'), 'call-event path must sanitize gclid');
  assert.ok(src.includes("source_type: (sanitizedGclid || sanitizedWbraid || sanitizedGbraid || sanitizedClickId) ? 'paid' : 'organic'"), 'paid classification must use sanitized identifiers only');
});

test('tracker call-event path no longer falls back to unsigned transport', () => {
  const src = readFileSync(TRACKER, 'utf8');
  assert.ok(src.includes('missing proxyUrl or signing secret'), 'tracker must explicitly refuse weak unsigned fallback');
  assert.ok(!src.includes('// Unsigned fallback'), 'unsigned fallback path must be removed');
});

test('V1 SSOT: tracker emits pageview pulses and Redis routing uses canonical site keys', () => {
  const trackerSrc = readFileSync(TRACKER, 'utf8');
  const exportSrc = readFileSync(OCI_EXPORT_ROUTE, 'utf8');
  const ackSrc = readFileSync(ACK_ROUTE, 'utf8');
  const v1GearSrc = readFileSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'gears', 'V1PageViewGear.ts'), 'utf8');
  const pulseRecoverySrc = readFileSync(join(ROOT, 'lib', 'oci', 'pulse-recovery-worker.ts'), 'utf8');
  assert.ok(trackerSrc.includes('sendPageViewPulse();'), 'tracker must actively emit V1 pageview pulses');
  assert.ok(trackerSrc.includes('fetch(CONFIG.pvUrl'), 'tracker must post V1 pageviews to track/pv');
  assert.ok(v1GearSrc.includes('getPvQueueKey(siteId)'), 'V1 gear must write to canonical PV queue key');
  assert.ok(exportSrc.includes('getPvQueueKeysForExport(siteUuid'), 'export must read canonical and legacy PV queue keys');
  assert.ok(ackSrc.includes('getPvProcessingKeysForCleanup(siteUuid'), 'ack must clean canonical and legacy PV processing keys');
  assert.ok(pulseRecoverySrc.includes('recoverStalePvProcessing'), 'pulse recovery must include V1 processing recovery');
  assert.ok(pulseRecoverySrc.includes('redis.rpush(queueKey, pvId)'), 'stale V1 processing rows must be requeued durably');
});

test('activity log allows cancel across sealed status family', () => {
  const src = readFileSync(ACTIVITY_LOG, 'utf8');
  assert.ok(src.includes("['confirmed', 'qualified', 'real'].includes(s)"), 'cancel button must stay available for sealed statuses');
});

test('qualification hook mutates only the clicked call so undo stays symmetric', () => {
  const src = readFileSync(INTENT_QUALIFICATION, 'utf8');
  assert.ok(src.includes("const callIds = [intentId];"), 'qualification must only target the clicked intent');
  assert.ok(!src.includes(".eq('matched_session_id', matchedSessionId as string)"), 'session-wide qualification fanout must be removed');
});

test('cron auth enforces dual-key production execution', () => {
  const src = readFileSync(CRON_AUTH, 'utf8');
  assert.ok(src.includes("const vercelRequestId = req.headers.get('x-vercel-id');"), 'cron auth must inspect x-vercel-id');
  assert.ok(src.includes('hasTrustedVercelProvenance') || src.includes("vercelCron === '1'"), 'cron auth must compute trusted Vercel provenance');
  assert.ok(src.includes('hasTrustedVercelProvenance && hasValidBearer'), 'production hybrid mode must require both provenance and bearer');
  assert.ok(src.includes('isMissingOrPlaceholderSecret'), 'cron auth must fail closed for placeholder secrets');
  assert.ok(src.includes("if (getCronAuthMode() === 'bearer_only')"), 'cron auth must support bearer-only mode');
});

test('oci workers re-check current call sendability before exporting or draining outbox', () => {
  const exportSrc = readFileSync(OCI_EXPORT_ROUTE, 'utf8');
  const outboxSrc = readFileSync(PROCESS_OUTBOX_ROUTE, 'utf8');
  assert.ok(exportSrc.includes('isCallSendableForSealExport'), 'queue export must re-check live call sendability');
  assert.ok(exportSrc.includes('CALL_NOT_SENDABLE_FOR_OCI'), 'queue export must terminalize reversed rows with explicit provenance');
  assert.ok(exportSrc.includes("dispatch_status: 'JUNK_ABORTED'"), 'blocked pending signals must be aborted before leak');
  assert.ok(outboxSrc.includes('isCallSendableForSealExport'), 'outbox worker must re-check live call sendability');
  assert.ok(outboxSrc.includes('CALL_NOT_SENDABLE_FOR_OCI'), 'outbox worker must fail reversed outbox rows explicitly');
  assert.ok(outboxSrc.includes("['MEETING_BOOKED', 'SEAL_PENDING', 'V3_ENGAGE', 'V4_INTENT']"), 'outbox duplicate prevention must query stored legacy signal types');
  assert.ok(outboxSrc.includes('normalizeExistingFunnelSignalType'), 'outbox duplicate prevention must normalize legacy signal types before backfill');
});

test('oci recovery routes and runner delegate to DB-owned batch kernels', () => {
  const sweepSrc = readFileSync(SWEEP_ZOMBIES_ROUTE, 'utf8');
  const runnerSrc = readFileSync(RUNNER, 'utf8');
  const migrationSrc = readFileSync(WORKER_BATCH_V2_MIGRATION, 'utf8');
  assert.ok(sweepSrc.includes("recover_stuck_offline_conversion_jobs"), 'sweep-zombies must delegate processing recovery to DB recovery RPC');
  assert.ok(sweepSrc.includes("append_sweeper_transition_batch"), 'sweep-zombies must use sweeper batch append for stale uploaded rows');
  assert.ok(runnerSrc.includes("append_worker_transition_batch_v2"), 'runner must use DB-owned worker batch rpc');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.append_worker_transition_batch_v2'), 'migration must define worker batch v2 rpc');
  assert.ok(migrationSrc.includes("ADD COLUMN IF NOT EXISTS updated_at"), 'outbox recovery migration must add updated_at for zombie detection');
});

test('oci script routes use atomic script transition batch rpc', () => {
  const ackSrc = readFileSync(ACK_ROUTE, 'utf8');
  const ackFailedSrc = readFileSync(ACK_FAILED_ROUTE, 'utf8');
  const migrationSrc = readFileSync(SCRIPT_BATCH_MIGRATION, 'utf8');
  assert.ok(ackSrc.includes("append_script_transition_batch"), 'ack route must use script batch rpc');
  assert.ok(ackFailedSrc.includes("append_script_transition_batch"), 'ack-failed route must use script batch rpc');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.append_script_transition_batch'), 'migration must define script batch rpc');
});

test('oci hardening migration adds reversal voiding and external_id invariants', () => {
  const src = readFileSync(OCI_HARDENING_MIGRATION, 'utf8');
  assert.ok(src.includes('compute_offline_conversion_external_id'), 'migration must define deterministic external_id helper');
  assert.ok(src.includes('idx_offline_conversion_queue_site_provider_external_id_active'), 'migration must add partial unique index for external_id');
  assert.ok(src.includes('VOIDED_BY_REVERSAL'), 'migration must extend queue ontology with VOIDED_BY_REVERSAL');
  assert.ok(src.includes('void_pending_oci_queue_on_call_reversal'), 'migration must define DB-level reversal void trigger');
});
