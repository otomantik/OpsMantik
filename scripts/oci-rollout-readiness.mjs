#!/usr/bin/env node
/**
 * OCI Google rollout readiness report (read-only).
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseArgs(argv) {
  const out = { site: null, json: false, strict: false, profile: 'prod', stuckMax: 20, retryRateMax: 0.3, failedRateMax: 0.2 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--site') out.site = argv[i + 1] || null;
    if (a === '--json') out.json = true;
    if (a === '--strict') out.strict = true;
    if (a === '--profile') out.profile = argv[i + 1] || out.profile;
    if (a === '--stuck-max') out.stuckMax = Number(argv[i + 1] || out.stuckMax);
    if (a === '--retry-rate-max') out.retryRateMax = Number(argv[i + 1] || out.retryRateMax);
    if (a === '--failed-rate-max') out.failedRateMax = Number(argv[i + 1] || out.failedRateMax);
  }
  const profileLimits = {
    dev: { stuckMax: 50, retryRateMax: 0.5, failedRateMax: 0.35 },
    stage: { stuckMax: 30, retryRateMax: 0.4, failedRateMax: 0.25 },
    prod: { stuckMax: 20, retryRateMax: 0.3, failedRateMax: 0.2 },
  };
  const selected = profileLimits[out.profile] || profileLimits.prod;
  if (!argv.includes('--stuck-max')) out.stuckMax = selected.stuckMax;
  if (!argv.includes('--retry-rate-max')) out.retryRateMax = selected.retryRateMax;
  if (!argv.includes('--failed-rate-max')) out.failedRateMax = selected.failedRateMax;
  return out;
}

async function loadSites(siteQuery) {
  const query = supabase
    .from('sites')
    .select('id, public_id, name, domain, oci_sync_method, oci_api_key, created_at')
    .order('created_at', { ascending: false });
  if (siteQuery) {
    query.or(`id.eq.${siteQuery},public_id.eq.${siteQuery},name.ilike.%${siteQuery}%,domain.ilike.%${siteQuery}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadEntitlement(siteId) {
  const { data, error } = await supabase.rpc('get_entitlements_for_site', { p_site_id: siteId });
  if (error) return { ok: false, tier: null, googleAdsSync: false, error: error.message };
  return { ok: true, tier: data?.tier ?? null, googleAdsSync: data?.capabilities?.google_ads_sync === true, error: null };
}

async function loadQueueAndOutbox(siteId) {
  const [{ data: queueRows, error: queueErr }, { data: outboxRows, error: outboxErr }] = await Promise.all([
    supabase.from('offline_conversion_queue').select('status, updated_at').eq('site_id', siteId),
    supabase.from('outbox_events').select('status, updated_at').eq('site_id', siteId),
  ]);
  const queueTableMissing = Boolean(queueErr?.message?.includes("Could not find the table 'public.offline_conversion_queue'"));
  const outboxTableMissing = Boolean(outboxErr?.message?.includes("Could not find the table 'public.outbox_events'"));
  if (queueErr && !queueTableMissing) throw queueErr;
  if (outboxErr && !outboxTableMissing) throw outboxErr;

  const queue = { QUEUED: 0, PROCESSING: 0, COMPLETED: 0, UPLOADED: 0, FAILED: 0, RETRY: 0, DLQ: 0 };
  for (const row of queueRows || []) {
    const s = String(row.status || '');
    if (s in queue) queue[s] += 1;
    if (s === 'DEAD_LETTER_QUARANTINE') queue.DLQ += 1;
  }
  const outbox = { PENDING: 0, PROCESSING: 0, PROCESSED: 0, FAILED: 0 };
  for (const row of outboxRows || []) {
    const s = String(row.status || '');
    if (s in outbox) outbox[s] += 1;
  }

  const totalQueue = (queueRows || []).length;
  const retryRate = totalQueue > 0 ? queue.RETRY / totalQueue : 0;
  const failedRate = totalQueue > 0 ? (queue.FAILED + queue.DLQ) / totalQueue : 0;
  const stuckCutoff = Date.now() - 15 * 60 * 1000;
  const stuckProcessing = (queueRows || []).filter(
    (r) => r.status === 'PROCESSING' && new Date(String(r.updated_at || 0)).getTime() < stuckCutoff
  ).length;
  return { queue, outbox, totalQueue, retryRate, failedRate, stuckProcessing, queueTableMissing, outboxTableMissing };
}

function evaluateGates(metrics, limits) {
  const failures = [];
  if (metrics.stuckProcessing > limits.stuckMax) failures.push(`stuckProcessing>${limits.stuckMax}`);
  if (metrics.retryRate > limits.retryRateMax) failures.push(`retryRate>${limits.retryRateMax}`);
  if (metrics.failedRate > limits.failedRateMax) failures.push(`failedRate>${limits.failedRateMax}`);
  return { pass: failures.length === 0, failures };
}

function recommendCanary(sites) {
  const eligible = sites
    .filter((s) => s.auth.hasApiKey && s.auth.googleAdsSync)
    .sort((a, b) => (a.metrics.totalQueue || 0) - (b.metrics.totalQueue || 0));
  return eligible[0] || null;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const siteRows = await loadSites(args.site);
  const reports = [];
  for (const site of siteRows) {
    const [authEnt, metrics] = await Promise.all([loadEntitlement(site.id), loadQueueAndOutbox(site.id)]);
    const gate = evaluateGates(metrics, args);
    reports.push({
      site: { id: site.id, public_id: site.public_id, name: site.name, domain: site.domain, mode: site.oci_sync_method || 'script' },
      auth: {
        hasApiKey: Boolean(site.oci_api_key),
        googleAdsSync: authEnt.googleAdsSync,
        tier: authEnt.tier,
        entitlementOk: authEnt.ok,
        entitlementError: authEnt.error,
      },
      metrics,
      gate,
    });
  }

  const modeCounts = reports.reduce((acc, r) => {
    const mode = r.site.mode || 'script';
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    totalSites: reports.length,
    modeCounts,
    authReadySites: reports.filter((r) => r.auth.hasApiKey && r.auth.googleAdsSync).length,
    gatePassSites: reports.filter((r) => r.gate.pass).length,
    tableSchemaWarnings: reports.filter((r) => r.metrics.queueTableMissing || r.metrics.outboxTableMissing).length,
  };
  const canary = recommendCanary(reports);
  const strictFailures = [];
  if (summary.totalSites === 0) strictFailures.push('no_sites_found');
  if (summary.authReadySites === 0) strictFailures.push('no_auth_ready_sites');
  if (summary.gatePassSites < summary.totalSites) strictFailures.push('observability_gate_failures_present');
  if (summary.tableSchemaWarnings > 0) strictFailures.push('schema_or_rpc_drift_detected');
  if (!canary) strictFailures.push('no_canary_candidate');

  if (args.json) {
    console.log(JSON.stringify({ summary, profile: args.profile, thresholds: { stuckMax: args.stuckMax, retryRateMax: args.retryRateMax, failedRateMax: args.failedRateMax }, canary: canary?.site || null, strict: { enabled: args.strict, pass: strictFailures.length === 0, failures: strictFailures }, reports }, null, 2));
    if (args.strict && strictFailures.length > 0) process.exit(1);
    return;
  }

  console.log('\n=== OCI MODE INVENTORY ===');
  console.log(summary);
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      mode: r.site.mode,
      apiKey: r.auth.hasApiKey ? 'yes' : 'no',
      googleAdsSync: r.auth.googleAdsSync ? 'yes' : 'no',
    }))
  );

  console.log('\n=== QUEUE / OUTBOX FLOW ===');
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      outboxPending: r.metrics.outbox.PENDING,
      queued: r.metrics.queue.QUEUED,
      processing: r.metrics.queue.PROCESSING,
      retry: r.metrics.queue.RETRY,
      failed: r.metrics.queue.FAILED + r.metrics.queue.DLQ,
      schemaWarning: r.metrics.queueTableMissing || r.metrics.outboxTableMissing ? 'yes' : 'no',
    }))
  );

  console.log('\n=== OBSERVABILITY GATES ===');
  console.table(
    reports.map((r) => ({
      site: r.site.name || r.site.public_id || r.site.id.slice(0, 8),
      pass: r.gate.pass ? 'PASS' : 'FAIL',
      stuckProcessing: r.metrics.stuckProcessing,
      retryRate: r.metrics.retryRate.toFixed(2),
      failedRate: r.metrics.failedRate.toFixed(2),
      reasons: r.gate.failures.join(', ') || '-',
    }))
  );

  console.log('\n=== CANARY RECOMMENDATION ===');
  if (!canary) {
    console.log('No eligible site found (requires apiKey + google_ads_sync).');
  } else {
    console.log({
      siteId: canary.site.id,
      publicId: canary.site.public_id,
      name: canary.site.name,
      mode: canary.site.mode,
      totalQueue: canary.metrics.totalQueue,
    });
  }

  if (args.strict) {
    if (strictFailures.length > 0) {
      console.error('\n=== STRICT GATE: FAIL ===');
      console.error(strictFailures.join(', '));
      process.exit(1);
    }
    console.log('\n=== STRICT GATE: PASS ===');
  }
}

run().catch((err) => {
  console.error('oci-rollout-readiness failed:', err?.message || err);
  process.exit(1);
});
