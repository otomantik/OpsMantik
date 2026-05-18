#!/usr/bin/env node
/**
 * Dry-run backfill: classify sessions with Source Truth v2 without mutating legacy columns.
 *
 * Usage:
 *   node scripts/backfill-source-truth.mjs --site=<uuid> [--days=30] [--apply]
 *
 * Default: dry-run report only. --apply writes traffic_v2_ledger only.
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const siteId = args.find((a) => a.startsWith('--site='))?.split('=')[1];
const days = Number(args.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 30);
const apply = args.includes('--apply');

if (!siteId) {
  console.error('Required: --site=<uuid>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key);
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', siteId, days, since }, null, 2));
console.error(
  'Classifier runs in Node via dynamic import — run with: node --import tsx scripts/backfill-source-truth.mjs ...'
);

const { classifyTraffic } = await import('../lib/attribution/truth-engine-core.ts');

const { data: rows, error } = await admin
  .from('sessions')
  .select('id, entry_page, referrer_host, traffic_source, traffic_medium, attribution_source, created_at')
  .eq('site_id', siteId)
  .gte('created_at', since)
  .limit(500);

if (error) {
  console.error(error.message);
  process.exit(1);
}

let driftPaid = 0;
let driftChannel = 0;

for (const row of rows ?? []) {
  const url = row.entry_page || 'https://invalid.local/';
  const referrer = row.referrer_host ? `https://${row.referrer_host}/` : '';
  const v2 = classifyTraffic(url, referrer, '', undefined);
  const legacyPaid =
    (row.attribution_source || '').toLowerCase().includes('paid') ||
    (row.traffic_source || '').toLowerCase().includes('google ads');
  if (legacyPaid !== v2.is_paid) driftPaid++;
  if (apply) {
    await admin.from('sessions').update({ traffic_v2_ledger: v2 }).eq('id', row.id);
  }
}

console.log(
  JSON.stringify(
    {
      scanned: rows?.length ?? 0,
      drift_paid_mismatch: driftPaid,
      drift_channel_skipped: driftChannel,
      applied: apply,
    },
    null,
    2
  )
);
