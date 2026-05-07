#!/usr/bin/env npx tsx
/**
 * For a site, enqueue won/sealed calls that are missing from WON_MISSING_PIPELINE (no protective queue row).
 * Uses enqueueSealConversion (same as sweep). Optional explicit --call-id= (repeatable).
 *
 * Default: dry-run (prints results for enqueueSealConversion which may still do idempotent lookups).
 * Pass --apply to run enqueue (writes queue when eligible).
 *
 * Usage:
 *   npx tsx scripts/oci/repair-enqueue-won-calls.ts --site=koc
 *   npx tsx scripts/oci/repair-enqueue-won-calls.ts --site=koc --apply
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient } from '../../lib/supabase/admin';
import { enqueueSealConversion } from '../../lib/oci/enqueue-seal-conversion';
import { listMissingWonPipelineCallIds } from '../../lib/oci/won-missing-pipeline-site';
import { normalizeCurrencyOrNeutral } from '../../lib/i18n/site-locale';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]) {
  let site: string | null = null;
  let apply = false;
  const callIds: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--site=')) site = a.slice('--site='.length).trim() || null;
    if (a === '--apply') apply = true;
    if (a.startsWith('--call-id=')) {
      const id = a.slice('--call-id='.length).trim();
      if (id) callIds.push(id);
    }
  }
  return { site, apply, callIds };
}

async function resolveSite(filter: string) {
  const orFilter = UUID_RE.test(filter.trim())
    ? `id.eq.${filter},public_id.eq.${filter}`
    : `name.ilike.%${filter}%,domain.ilike.%${filter}%,public_id.ilike.%${filter}%`;
  const { data, error } = await adminClient.from('sites').select('id, name, domain').or(orFilter).limit(2);
  if (error) throw error;
  if (!data?.length) {
    console.error('No site matched:', filter);
    process.exit(1);
  }
  if (data.length > 1) {
    console.error('Ambiguous --site=');
    process.exit(1);
  }
  return data[0] as { id: string; name: string; domain: string | null };
}

async function main() {
  const { site: siteFilter, apply, callIds: explicitCalls } = parseArgs(process.argv.slice(2));
  if (!siteFilter) {
    console.error('Usage: npx tsx scripts/oci/repair-enqueue-won-calls.ts --site=<filter> [--apply] [--call-id=uuid ...]');
    process.exit(1);
  }

  const site = await resolveSite(siteFilter);
  const siteId = site.id;

  let targets: string[];
  if (explicitCalls.length > 0) {
    targets = explicitCalls;
  } else {
    targets = await listMissingWonPipelineCallIds(adminClient, siteId);
  }

  console.log(`\nsite: ${site.name} (${site.domain})`);
  console.log(`site_id: ${siteId}`);
  console.log(`mode: ${apply ? 'APPLY (writes when eligible)' : 'dry-run (no enqueue; pass --apply)'}`);
  console.log(`targets: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  let ok = 0;
  let skipped = 0;

  for (const callId of targets) {
    const { data: call, error } = await adminClient
      .from('calls')
      .select('id, site_id, status, oci_status, confirmed_at, sale_amount, lead_score')
      .eq('id', callId)
      .eq('site_id', siteId)
      .maybeSingle();

    if (error) throw error;
    if (!call) {
      console.log(`call_id ${callId}: not found for site — skip`);
      skipped++;
      continue;
    }

    const c = call as {
      id: string;
      confirmed_at: string | null;
      sale_amount: number | null;
      currency: string | null;
      lead_score: number | null;
    };

    if (!c.confirmed_at) {
      console.log(`call_id ${callId}: no confirmed_at — skip`);
      skipped++;
      continue;
    }

    if (!apply) {
      console.log(`call_id ${callId}: dry-run only; re-run with --apply to enqueue`);
      continue;
    }

    const result = await enqueueSealConversion({
      callId: c.id,
      siteId,
      confirmedAt: c.confirmed_at,
      saleAmount: c.sale_amount ?? null,
      currency: normalizeCurrencyOrNeutral(c.currency),
      leadScore: c.lead_score ?? null,
      entryReason: 'repair_enqueue_won_pipeline',
    });

    if (result.enqueued) {
      console.log(`call_id ${callId}: ENQUEUED queue_id=${result.queueId ?? '?'}`);
      ok++;
    } else {
      console.log(`call_id ${callId}: not enqueued reason=${result.reason ?? '?'} ${result.error ?? ''}`);
      skipped++;
    }
  }

  console.log(`\ndone: enqueued=${ok} skipped/failed=${skipped}`);
  if (!apply) {
    console.log('\n(No writes: pass --apply to call enqueueSealConversion.)');
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
