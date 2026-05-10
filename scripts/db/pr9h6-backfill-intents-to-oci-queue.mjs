#!/usr/bin/env node
/**
 * PR-9H.6 / PR-9H.6.1 — Dry-run (default) gap report; APPLY=1 delegates to TypeScript apply.
 *
 * Usage:
 *   TARGET_SITE_ID=<uuid|public_id> node scripts/db/pr9h6-backfill-intents-to-oci-queue.mjs
 *
 * Apply (exact site, hard cap, stage allowlist):
 *   APPLY=1 \
 *   I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL=I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL \
 *   TARGET_SITE_ID=<uuid|public_id> \
 *   STAGE_ALLOWLIST=contacted,offered,won,junk_exclusion \
 *   MAX_ROWS=500 \
 *   node scripts/db/pr9h6-backfill-intents-to-oci-queue.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
const apply =
  process.env.APPLY === '1' &&
  process.env.I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL === 'I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL';
const stageAllowRaw = String(process.env.STAGE_ALLOWLIST || '').trim();
const maxRows = Math.min(5000, Math.max(1, parseInt(String(process.env.MAX_ROWS || '500'), 10) || 500));

if (!url || !key) {
  console.error(JSON.stringify({ ok: false, code: 'ENV_MISSING' }, null, 2));
  process.exit(1);
}

if (apply) {
  if (!stageAllowRaw) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: 'STAGE_ALLOWLIST_REQUIRED',
          hint:
            'Set STAGE_ALLOWLIST=contacted,offered,won,junk_exclusion (subset). APPLY never runs without explicit stages.',
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  let resolved;
  try {
    const adminProbe = createClient(url, key);
    resolved = await resolveSiteIdentity(adminProbe, rawTarget);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, detail: String(e) }, null, 2));
    process.exit(1);
  }

  if (!resolved.found) {
    console.error(JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }, null, 2));
    process.exit(1);
  }

  const applyScriptRel = join('scripts', 'db', 'pr9h6-backfill-queue-apply.ts');
  const cmd = `npx tsx ${applyScriptRel}`;
  const r = spawnSync(cmd, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

let resolved;
try {
  resolved = await resolveSiteIdentity(createClient(url, key), rawTarget);
} catch (e) {
  console.error(JSON.stringify({ ok: false, detail: String(e) }, null, 2));
  process.exit(1);
}

if (!resolved.found) {
  console.error(JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }, null, 2));
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

const adminClient = createClient(url, key);

const { data: calls, error: cErr } = await adminClient
  .from('calls')
  .select('id, status, created_at, updated_at')
  .eq('site_id', siteUuid)
  .in('status', ['confirmed', 'qualified', 'real', 'junk', 'won', 'contacted', 'intent'])
  .order('updated_at', { ascending: false })
  .limit(maxRows);

if (cErr) {
  console.error(JSON.stringify({ ok: false, detail: cErr.message }, null, 2));
  process.exit(1);
}

const { data: qrows, error: qErr } = await adminClient
  .from('offline_conversion_queue')
  .select('call_id, action')
  .eq('site_id', siteUuid)
  .eq('provider_key', 'google_ads');

if (qErr) {
  console.error(JSON.stringify({ ok: false, detail: qErr.message }, null, 2));
  process.exit(1);
}

const queueByCall = new Set();
for (const q of qrows || []) {
  if (q.call_id) queueByCall.add(String(q.call_id));
}

let missingQueue = 0;
for (const c of calls || []) {
  if (!queueByCall.has(String(c.id))) missingQueue += 1;
}

const out = {
  ok: true,
  dry_run: true,
  site: { sites_id: siteUuid, input: resolved.input },
  max_rows_sample: maxRows,
  calls_sampled: (calls || []).length,
  calls_without_any_queue_row_for_call_id: missingQueue,
  apply_hint:
    'To APPLY for this site: set APPLY=1, I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL, STAGE_ALLOWLIST, MAX_ROWS, TARGET_SITE_ID; run same command.',
};

console.log(JSON.stringify(out, null, 2));
