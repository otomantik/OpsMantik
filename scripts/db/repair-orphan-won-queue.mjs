#!/usr/bin/env node
/**
 * PR-7C controlled orphan won repair tool.
 *
 * Default: dry-run (read-only SQL).
 * Write mode: heavily gated + site-scoped only.
 * Write path calls canonical app sweeper endpoint (enqueueSealConversion path).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');
loadEnv({ path: join(repoRoot, '.env.local') });

const DRY_RUN_SQL = readFileSync(join(repoRoot, 'scripts', 'sql', 'orphan_won_backfill.sql'), 'utf8');

function parseArgs(argv) {
  const out = {
    write: false,
    targetSiteId: process.env.TARGET_SITE_ID || '',
    changeTicket: process.env.CHANGE_TICKET || '',
    operatorId: process.env.OPERATOR_ID || '',
    confirm: process.env.CONFIRM_ORPHAN_WON_REPAIR || '',
    baseUrl: process.env.APP_BASE_URL || '',
    cronSecret: process.env.CRON_SECRET || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    if (a === '--site' || a === '--target-site-id') out.targetSiteId = argv[i + 1] || out.targetSiteId;
    if (a === '--change-ticket') out.changeTicket = argv[i + 1] || out.changeTicket;
    if (a === '--operator-id') out.operatorId = argv[i + 1] || out.operatorId;
    if (a === '--base-url') out.baseUrl = argv[i + 1] || out.baseUrl;
    if (a === '--cron-secret') out.cronSecret = argv[i + 1] || out.cronSecret;
    if (a.startsWith('--site=')) out.targetSiteId = a.slice('--site='.length);
    if (a.startsWith('--change-ticket=')) out.changeTicket = a.slice('--change-ticket='.length);
    if (a.startsWith('--operator-id=')) out.operatorId = a.slice('--operator-id='.length);
    if (a.startsWith('--base-url=')) out.baseUrl = a.slice('--base-url='.length);
    if (a.startsWith('--cron-secret=')) out.cronSecret = a.slice('--cron-secret='.length);
  }
  return out;
}

function requiredForWrite(args) {
  const errors = [];
  if (!args.targetSiteId) errors.push('TARGET_SITE_ID is required');
  if (!args.changeTicket) errors.push('CHANGE_TICKET is required');
  if (!args.operatorId) errors.push('OPERATOR_ID is required');
  if (args.confirm !== 'I_UNDERSTAND') {
    errors.push('CONFIRM_ORPHAN_WON_REPAIR must equal I_UNDERSTAND');
  }
  if (!args.baseUrl) errors.push('APP_BASE_URL is required for canonical write path');
  if (!args.cronSecret) errors.push('CRON_SECRET is required for canonical write path');
  return errors;
}

async function runDryRun(siteId) {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL or DATABASE_URL is required for dry-run SQL');
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(DRY_RUN_SQL);
    const rows = (result.rows || []).filter((r) => !siteId || r.site_id === siteId);
    const summary = rows.reduce((acc, row) => {
      const key = `${row.site_id}::${row.repair_class}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return {
      mode: 'dry-run',
      target_site_id: siteId || null,
      candidate_count: rows.length,
      auto_repairable_count: rows.filter((r) => Number(r.can_auto_repair || 0) === 1).length,
      summary,
      candidates: rows,
    };
  } finally {
    await client.end();
  }
}

async function runWriteViaCanonicalPath(args) {
  const errors = requiredForWrite(args);
  if (errors.length > 0) {
    return { ok: false, mode: 'write', blocked: true, errors };
  }

  const url = new URL('/api/cron/sweep-unsent-conversions', args.baseUrl);
  url.searchParams.set('site_id', args.targetSiteId);
  url.searchParams.set('change_ticket', args.changeTicket);
  url.searchParams.set('operator_id', args.operatorId);
  url.searchParams.set('confirm', args.confirm);
  url.searchParams.set('dry_run', '0');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.cronSecret}`,
      'x-opsmantik-change-ticket': args.changeTicket,
      'x-opsmantik-operator-id': args.operatorId,
      'x-opsmantik-repair-confirm': args.confirm,
    },
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'invalid_json_response' }));
  return {
    ok: res.ok && data?.ok === true,
    mode: 'write',
    target_site_id: args.targetSiteId,
    change_ticket: args.changeTicket,
    operator_id: args.operatorId,
    response_status: res.status,
    result: data,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.write) {
    const dryRun = await runDryRun(args.targetSiteId);
    console.log(JSON.stringify(dryRun, null, 2));
    return;
  }

  const gate = requiredForWrite(args);
  if (gate.length > 0) {
    console.error(JSON.stringify({ ok: false, mode: 'write', blocked: true, errors: gate }, null, 2));
    process.exit(1);
  }

  const writeResult = await runWriteViaCanonicalPath(args);
  console.log(JSON.stringify(writeResult, null, 2));
  if (!writeResult.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
