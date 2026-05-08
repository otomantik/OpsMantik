import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-7C orphan_won_backfill SQL is dry-run/read-only', () => {
  const sql = readFileSync(join(ROOT, 'scripts', 'sql', 'orphan_won_backfill.sql'), 'utf8');
  assert.ok(sql.includes('-- Read-only candidate discovery'));
  assert.ok(!/\binsert\b/i.test(sql));
  assert.ok(!/\bupdate\b/i.test(sql));
  assert.ok(!/\bdelete\b/i.test(sql));
});

test('PR-7C orphan_won_backfill SQL detects won/sealed and excludes represented queue rows', () => {
  const sql = readFileSync(join(ROOT, 'scripts', 'sql', 'orphan_won_backfill.sql'), 'utf8');
  assert.ok(sql.includes("c.status = 'won' OR c.oci_status = 'sealed'"));
  assert.ok(sql.includes("COALESCE(qc.has_active_pipeline, false) = false"));
  assert.ok(sql.includes("COALESCE(qc.has_completed_pipeline, false) = false"));
});

test('PR-7C repair script defaults to dry-run and has write-mode hard gates', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'db', 'repair-orphan-won-queue.mjs'), 'utf8');
  assert.ok(src.includes('if (!args.write)'));
  assert.ok(src.includes('TARGET_SITE_ID is required'));
  assert.ok(src.includes('CHANGE_TICKET is required'));
  assert.ok(src.includes('OPERATOR_ID is required'));
  assert.ok(src.includes('CONFIRM_ORPHAN_WON_REPAIR must equal I_UNDERSTAND'));
});

test('PR-7C repair script uses canonical enqueue path via sweep-unsent endpoint', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'db', 'repair-orphan-won-queue.mjs'), 'utf8');
  const route = readFileSync(join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts'), 'utf8');
  assert.ok(src.includes("/api/cron/sweep-unsent-conversions"));
  assert.ok(route.includes('enqueueSealConversion'));
  assert.ok(route.includes("const targetSiteId = normalizeSiteId(targetSiteIdRaw)"));
  assert.ok(route.includes("const dryRun = parseFlag(req.nextUrl.searchParams.get('dry_run'))"));
});

test('PR-7C no queue deletion or direct hardcoded value math introduced', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'db', 'repair-orphan-won-queue.mjs'), 'utf8');
  const route = readFileSync(join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts'), 'utf8');
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(script));
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(route));
  assert.ok(!/value_cents\s*=/i.test(script));
});

test('PR-7C idempotency path still relies on enqueueSealConversion duplicate guard (23505)', () => {
  const enqueue = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(enqueue.includes("if (error.code === '23505')"));
  assert.ok(enqueue.includes("reason: 'duplicate'"));
});

test('PR-7C wonMissingPipeline remains strict gate blocker', () => {
  const contract = readFileSync(join(ROOT, 'lib', 'oci', 'queue-health-contract.ts'), 'utf8');
  assert.ok(contract.includes('wonMissingPipelineCount'));
  assert.ok(contract.includes("failures.push('wonMissingPipeline>0')"));
});
