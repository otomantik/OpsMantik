import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readMigrationByContractHintsOptional,
} from '@/tests/helpers/migration-contract-resolver';

const ROOT = process.cwd();
const INTENT_STATUS_ROUTE = join(ROOT, 'app', 'api', 'intents', '[id]', 'status', 'route.ts');
const ACK_ROUTE = join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts');
const ACK_FAILED_ROUTE = join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts');
const OCI_EXPORT_ROUTE = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
const PROCESS_OUTBOX_LIB = join(ROOT, 'lib', 'oci', 'outbox', 'process-outbox.ts');
const SWEEP_ZOMBIES_ROUTE = join(ROOT, 'app', 'api', 'cron', 'oci', 'sweep-zombies', 'route.ts');
const PROCESS_CALL_EVENT = join(ROOT, 'lib', 'ingest', 'process-call-event.ts');
const INTENT_QUALIFICATION = join(ROOT, 'lib', 'hooks', 'use-intent-qualification.ts');
const CRON_AUTH = join(ROOT, 'lib', 'cron', 'require-cron-auth.ts');
const TRACKER = join(ROOT, 'lib', 'tracker', 'tracker.js');
const ACTIVITY_LOG = join(ROOT, 'components', 'dashboard', 'qualification-queue', 'activity-log-inline.tsx');
const STAGE_ROUTE = join(ROOT, 'app', 'api', 'calls', '[id]', 'stage', 'route.ts');

test('intent status route: atomic RPC + OCI outbox notify (delegates v2 internally)', () => {
  const src = readFileSync(INTENT_STATUS_ROUTE, 'utf8');
  assert.ok(
    src.includes("adminClient.rpc('apply_call_action_with_review_v1'"),
    'status route must use apply_call_action_with_review_v1 (wraps v2)'
  );
  assert.ok(src.includes('p_actor_id: user.id'), 'queue actions must preserve human actor id for audit lineage');
  assert.ok(src.includes('invalidatePendingOciArtifactsForCall'), 'reversal actions must invalidate pending OCI artifacts');
  assert.ok(src.includes('enqueuePanelStageOciOutbox'), 'junk/restore mutations must enqueue IntentSealed outbox');
  assert.ok(src.includes('notifyOutboxPending'), 'junk/restore must notify outbox processor');
});

test('call action rpc lineage: system actors are normalized before call_actions append', () => {
  const migration = readMigrationByContractHintsOptional([
    'v_actor_type :=',
    'INSERT INTO public.call_actions',
    'apply_call_action_v2',
  ]);
  if (!migration) {
    assert.ok(true, 'actor normalization migration not present in current snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes("v_actor_type := 'system';"), 'non-user actors must normalize to system');
  assert.ok(src.includes('INSERT INTO public.call_actions') && src.includes('v_actor_type'), 'normalized actor_type must be appended to call_actions');
});

test('single-head cleanup: call sale review is DB-owned and stage shadow route is retired', () => {
  const migration = readMigrationByContractHintsOptional([
    'review_call_sale_time_v1',
    'INSERT INTO public.outbox_events',
    'sale_review',
  ]);
  if (!migration) {
    assert.ok(true, 'single-head review migration not present in current snapshot');
    return;
  }
  const migrationSrc = migration.source;
  const stageSrc = readFileSync(STAGE_ROUTE, 'utf8');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.review_call_sale_time_v1'), 'cleanup migration must define review_call_sale_time_v1');
  assert.ok(migrationSrc.includes('INSERT INTO public.outbox_events'), 'review rpc must emit outbox rows transactionally');
  assert.ok(stageSrc.includes('PIPELINE_STAGE_ROUTE_RETIRED'), 'stage route must be explicitly retired');
});

test('call-event ingestion sanitizes click ids before paid classification', () => {
  const src = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(src.includes('const sanitizedGclid = sanitizeClickId(payload.gclid) ?? sanitizedClickId;'), 'call-event path must sanitize gclid');
  assert.ok(src.includes('deriveCallEventAuthoritativePaidOrganic({'), 'paid classification must route through authoritative helper');
  assert.ok(src.includes('sanitizedGclid') && src.includes('sanitizedWbraid') && src.includes('sanitizedGbraid') && src.includes('sanitizedClickId'), 'authoritative helper must only use sanitized identifiers');
  assert.ok(src.includes('source_type: authoritativeCallEventSourceType'), 'calls.source_type must be populated from authoritative helper output');
});

test('tracker call-event path no longer falls back to unsigned transport', () => {
  const src = readFileSync(TRACKER, 'utf8');
  assert.ok(src.includes('missing proxyUrl or signing secret'), 'tracker must explicitly refuse weak unsigned fallback');
  assert.ok(!src.includes('// Unsigned fallback'), 'unsigned fallback path must be removed');
});

test('V1 SSOT: /api/track/pv endpoint and V1 tracker pipeline stay fully retired post-cutover', () => {
  const trackerSrc = readFileSync(TRACKER, 'utf8');
  const exportSrc = readFileSync(OCI_EXPORT_ROUTE, 'utf8');
  const pvRoutePath = join(ROOT, 'app', 'api', 'track', 'pv', 'route.ts');
  assert.ok(!trackerSrc.includes('fetch(CONFIG.pvUrl'), 'tracker must not POST to the deprecated /api/track/pv endpoint');
  assert.ok(!trackerSrc.includes('CONFIG.pvUrl'), 'tracker must not reference the removed pvUrl config');
  if (existsSync(pvRoutePath)) {
    const pvRoute = readFileSync(pvRoutePath, 'utf8');
    assert.ok(pvRoute.includes('endpoint_removed') && pvRoute.includes('410'), '/api/track/pv must return 410 Gone with endpoint_removed marker');
  } else {
    assert.ok(true, '/api/track/pv route is fully removed');
  }
  assert.ok(!existsSync(join(ROOT, 'lib', 'domain', 'mizan-mantik', 'gears', 'V1PageViewGear.ts')), 'legacy V1 gear implementation must stay deleted');
  assert.ok(!exportSrc.includes('getPvQueueKeysForExport(siteUuid'), 'export must not reintroduce PV queue export after the cutover');
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
  const exportSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-build-items.ts'), 'utf8');
  const outboxSrc = readFileSync(PROCESS_OUTBOX_LIB, 'utf8');
  assert.ok(exportSrc.includes('status, oci_status'), 'queue export must fetch live call status context');
  assert.ok(exportSrc.includes("blockedSignalIds"), 'queue export must track blocked signals before terminalization');
  const markSrc = readFileSync(join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'), 'utf8');
  assert.ok(
    markSrc.includes("dispatch_status: 'JUNK_ABORTED'") || markSrc.includes("newStatus: 'JUNK_ABORTED'"),
    'blocked pending signals must be aborted before leak'
  );
  assert.ok(outboxSrc.includes('isCallSendableForSealExport'), 'outbox worker must re-check live call sendability');
  assert.ok(outboxSrc.includes('CALL_NOT_SENDABLE_FOR_OCI'), 'outbox worker must fail reversed outbox rows explicitly');
  assert.ok(outboxSrc.includes(".select('id, signal_type, optimization_stage')"), 'outbox duplicate prevention must inspect both legacy and canonical signal columns');
  assert.ok(outboxSrc.includes('resolveSignalStageFromExisting({'), 'outbox duplicate prevention must normalize canonical optimization stages and legacy aliases together');
});

test('oci recovery routes and runner delegate to DB-owned batch kernels', () => {
  const sweepSrc = readFileSync(SWEEP_ZOMBIES_ROUTE, 'utf8');
  const runnerSrc = readFileSync(join(ROOT, 'lib', 'oci', 'runner', 'queue-bulk-update.ts'), 'utf8');
  const migration = readMigrationByContractHintsOptional([
    'append_worker_transition_batch_v2',
    'claim_outbox_events',
    'outbox_events',
  ]);
  if (!migration) {
    assert.ok(true, 'worker batch migration contract missing from snapshot');
    return;
  }
  const migrationSrc = migration.source;
  assert.ok(sweepSrc.includes("recover_stuck_offline_conversion_jobs"), 'sweep-zombies must delegate processing recovery to DB recovery RPC');
  assert.ok(sweepSrc.includes("close_stale_uploaded_conversions"), 'sweep-zombies must close stale uploaded rows via DB atomic rpc');
  assert.ok(runnerSrc.includes("append_worker_transition_batch_v2"), 'runner must use DB-owned worker batch rpc');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.append_worker_transition_batch_v2'), 'migration must define worker batch v2 rpc');
  assert.ok(migrationSrc.includes('outbox_events'), 'migration must include outbox support contracts');
});

test('oci script routes use atomic script transition batch rpc', () => {
  const ackSrc = readFileSync(ACK_ROUTE, 'utf8');
  const ackFailedSrc = readFileSync(ACK_FAILED_ROUTE, 'utf8');
  const migration = readMigrationByContractHintsOptional([
    'append_script_transition_batch',
    'append_script_claim_transition_batch',
    'CREATE OR REPLACE FUNCTION public.append_script_transition_batch',
  ]);
  if (!migration) {
    assert.ok(true, 'script batch migration contract missing from snapshot');
    return;
  }
  const migrationSrc = migration.source;
  assert.ok(ackSrc.includes("append_script_transition_batch"), 'ack route must use script batch rpc');
  assert.ok(ackFailedSrc.includes("append_script_transition_batch"), 'ack-failed route must use script batch rpc');
  assert.ok(migrationSrc.includes('CREATE OR REPLACE FUNCTION public.append_script_transition_batch'), 'migration must define script batch rpc');
});

test('oci ssot migration adds blocked predecessor status and reconciliation events table', () => {
  const path = join(ROOT, 'supabase', 'migrations', '20260503100000_oci_ssot_blocked_and_reconciliation.sql');
  if (!existsSync(path)) {
    assert.ok(true, 'oci ssot migration not in workspace');
    return;
  }
  const src = readFileSync(path, 'utf8');
  assert.ok(src.includes('BLOCKED_PRECEDING_SIGNALS'), 'ssot migration must add BLOCKED_PRECEDING_SIGNALS');
  assert.ok(src.includes('oci_reconciliation_events'), 'ssot migration must create oci_reconciliation_events');
});

test('oci hardening migration adds reversal voiding and external_id invariants', () => {
  const migration = readMigrationByContractHintsOptional([
    'compute_offline_conversion_external_id',
    'VOIDED_BY_REVERSAL',
    'void_pending_oci_queue_on_call_reversal',
  ]);
  if (!migration) {
    assert.ok(true, 'oci hardening migration contract missing from snapshot');
    return;
  }
  const src = migration.source;
  assert.ok(src.includes('compute_offline_conversion_external_id'), 'migration must define deterministic external_id helper');
  assert.ok(src.includes('idx_offline_conversion_queue_site_provider_external_id_active'), 'migration must add partial unique index for external_id');
  assert.ok(src.includes('VOIDED_BY_REVERSAL'), 'migration must extend queue ontology with VOIDED_BY_REVERSAL');
  assert.ok(src.includes('void_pending_oci_queue_on_call_reversal'), 'migration must define DB-level reversal void trigger');
});
