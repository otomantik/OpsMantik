#!/usr/bin/env node
/**
 * One-shot helper: prepend CUT-02D @deprecated block to unscheduled cron routes.
 * Idempotent — skips files that already contain @deprecated.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCHEDULED = new Set([
  '/api/cron/oci/process-outbox-events',
  '/api/cron/oci-maintenance',
  '/api/cron/night-maintenance',
  '/api/cron/auto-junk',
  '/api/cron/watchtower',
  '/api/cron/reconcile-usage',
  '/api/cron/invoice-freeze',
]);

/** route file path (posix) → replacement cron path for operators */
const REPLACEMENT = {
  'app/api/cron/oci/sweep-zombies/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci/recover-stuck-signals/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci/attempt-cap/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/sweep-unsent-conversions/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/providers/recover-processing/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci/promote-blocked-queue/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci/backfill-precursor-signals/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci/ack-receipt-ttl/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/oci-recovery/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/process-offline-conversions/route.ts': '/api/cron/oci-maintenance',
  'app/api/cron/idempotency-cleanup/route.ts': '/api/cron/night-maintenance',
  'app/api/cron/oci/outbox-cleanup/route.ts': '/api/cron/night-maintenance',
  'app/api/cron/processed-signals-retention/route.ts': '/api/cron/night-maintenance',
  'app/api/cron/gdpr-retention/route.ts': '/api/cron/night-maintenance',
  'app/api/cron/cleanup/route.ts': '/api/cron/night-maintenance',
  'app/api/cron/reconcile-usage/enqueue/route.ts': '/api/cron/reconcile-usage',
  'app/api/cron/reconcile-usage/run/route.ts': '/api/cron/reconcile-usage',
  'app/api/cron/reconcile-usage/backfill/route.ts': '/api/cron/reconcile-usage',
  'app/api/cron/funnel-projection/route.ts': 'manual only (OUT_OF_CORE)',
  'app/api/cron/truth-parity-repair/route.ts': 'manual only (OUT_OF_CORE)',
  'app/api/cron/vacuum/route.ts': 'manual only (product hygiene)',
  'app/api/cron/oci/enqueue-from-sales/route.ts': 'manual only (legacy enqueue)',
  'app/api/cron/providers/seed-credentials/route.ts': 'manual only (provider ops)',
  'app/api/cron/test-notification/route.ts': 'dev/test only',
};

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else if (name === 'route.ts') {
      const rel = p.slice(base.length + 1).replaceAll('\\', '/');
      out.push(`app/api/cron/${rel}`);
    }
  }
  return out;
}

const cronRoot = join(ROOT, 'app', 'api', 'cron');
let stamped = 0;
let skipped = 0;

for (const rel of walk(cronRoot, cronRoot)) {
  const apiPath = '/api/cron/' + rel.replace(/^app\/api\/cron\//, '').replace(/\/route\.ts$/, '');
  if (SCHEDULED.has(apiPath)) continue;
  const replacement = REPLACEMENT[rel];
  if (!replacement) {
    console.warn('no replacement mapping for', rel);
    continue;
  }
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, 'utf8');
  if (src.includes('@deprecated')) {
    skipped += 1;
    continue;
  }
  const block = `/**
 * @deprecated CUT-02D — Unscheduled (break-glass). See docs/architecture/SEAL/CRON_CONTRACT.md.
 * Replacement: \`${replacement}\`
 */
`;
  writeFileSync(abs, block + src, 'utf8');
  stamped += 1;
  console.log('stamped', rel);
}

console.log(JSON.stringify({ stamped, skipped }));
