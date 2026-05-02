#!/usr/bin/env node
/**
 * OCI boru hattı: eksik outbox backfill → (opsiyonel) worker-first drain → özet rapor.
 *
 * 1) outbox_events: seal/stage sonrası kaçmış satırlar — oci-outbox-missed-backfill ile.
 * 2) drain: BASE_URL + CRON_SECRET ile POST /api/workers/oci/process-outbox (varsayılan)
 *    --use-cron-lock verilirse cron endpointi kullanılır.
 *    claim_outbox_events → marketing_signals / offline_conversion_queue.
 * 3) rapor: outbox durumları + offline_conversion_queue + marketing_signals.dispatch_status (site bazlı öz).
 *
 * Kullanım:
 *   node scripts/db/oci-pipeline-fill-and-report.mjs
 *   node scripts/db/oci-pipeline-fill-and-report.mjs --site 7eb8f5c0-4a96-4a0e-bd89-a463127b26b8
 *   node scripts/db/oci-pipeline-fill-and-report.mjs --no-backfill --no-drain   # salt rapor
 */
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OCI_RECONCILIATION_REASONS } from './oci-reconciliation-reasons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv) {
  return {
    site: argv.includes('--site') ? argv[argv.indexOf('--site') + 1] || null : null,
    noBackfill: argv.includes('--no-backfill'),
    noDrain: argv.includes('--no-drain'),
    maxBatches: (() => {
      const i = argv.indexOf('--max-batches');
      if (i < 0) return 120;
      const n = parseInt(argv[i + 1], 10);
      return Number.isFinite(n) && n > 0 ? n : 120;
    })(),
    useCronLock: argv.includes('--use-cron-lock'),
    reconciliationWindow: (() => {
      const i = argv.indexOf('--window');
      const raw = i < 0 ? 'last_24h' : String(argv[i + 1] || '').trim();
      return raw === 'last_1h' || raw === 'last_24h' || raw === 'last_7d' ? raw : 'last_24h';
    })(),
    json: argv.includes('--json'),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const WINDOW_MS = {
  last_1h: 60 * 60 * 1000,
  last_24h: 24 * 60 * 60 * 1000,
  last_7d: 7 * 24 * 60 * 60 * 1000,
};

async function drainOutboxOverHttp(maxBatches, useCronLock) {
  const base =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const secret = process.env.CRON_SECRET;
  if (!base || !/^https?:\/\//i.test(String(base))) {
    console.warn('[drain] BASE_URL veya NEXT_PUBLIC_APP_URL eksik / geçersiz — drain atlandı.');
    return { skipped: true, reason: 'no_base_url', rounds: [], totalClaimed: 0, totalProcessed: 0 };
  }
  if (!secret) {
    console.warn('[drain] CRON_SECRET eksik — drain atlandı. Manuel: npm run db:oci-drain-remote');
    return { skipped: true, reason: 'no_cron_secret', rounds: [], totalClaimed: 0, totalProcessed: 0 };
  }

  const endpoint = useCronLock
    ? `${String(base).replace(/\/$/, '')}/api/cron/oci/process-outbox-events`
    : `${String(base).replace(/\/$/, '')}/api/workers/oci/process-outbox`;
  const rounds = [];
  let totalClaimed = 0;
  let totalProcessed = 0;

  try {
    for (let r = 0; r < maxBatches; r++) {
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: useCronLock
            ? { Authorization: `Bearer ${secret}` }
            : {
                Authorization: `Bearer ${secret}`,
                'x-opsmantik-internal-worker': '1',
              },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[drain] fetch başarısız (BASE_URL doğru mu? prod: https://console.opsmantik.com):', msg);
        return {
          skipped: false,
          ok: false,
          rounds,
          totalClaimed,
          totalProcessed,
          error: { fetchError: msg },
        };
      }
      const text = await res.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { parseError: true, raw: text.slice(0, 400) };
      }

      rounds.push({
        round: r + 1,
        status: res.status,
        skipped: body.skipped,
        reason: body.reason,
        claimed: body.claimed,
        processed: body.processed,
        failed: body.failed,
        message: body.message,
      });

      if (!res.ok) {
        console.error('[drain] HTTP hata', res.status, body);
        return { skipped: false, ok: false, rounds, totalClaimed, totalProcessed, error: body };
      }

      if (useCronLock && body.skipped && body.reason === 'lock_held') {
        await sleep(2500);
        continue;
      }

      totalClaimed += Number(body.claimed || 0);
      totalProcessed += Number(body.processed || 0);

      if (body.message === 'no_pending_events') break;
      if (Number(body.claimed || 0) === 0 && !body.skipped) break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[drain]', msg);
    return { skipped: false, ok: false, rounds, totalClaimed, totalProcessed, error: { unexpected: msg } };
  }

  return { skipped: false, ok: true, rounds, totalClaimed, totalProcessed };
}

function countBy(rows, field) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const row of rows || []) {
    const k = String(row[field] ?? 'NULL').trim();
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

/** Paginate one site + table; only needed columns to keep memory bounded. */
async function fetchSiteFieldPages(admin, table, siteId, fieldName) {
  const page = 3000;
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(fieldName)
      .eq('site_id', siteId)
      .range(from, from + page - 1);
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < page) break;
    from += page;
  }
  return out;
}

async function fetchSiteFieldPagesSince(admin, table, siteId, fieldName, sinceIso) {
  const page = 3000;
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(fieldName)
      .eq('site_id', siteId)
      .gte('created_at', sinceIso)
      .range(from, from + page - 1);
    if (error) throw error;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < page) break;
    from += page;
  }
  return out;
}

async function fetchQueueSamples(admin, siteId, limit) {
  const { data, error } = await admin
    .from('offline_conversion_queue')
    .select('id,status,call_id')
    .eq('site_id', siteId)
    .in('status', ['QUEUED', 'RETRY'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function buildReport(siteIdFilter, reconciliationWindow) {
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let sites = [];
  const { data: siteRows } = await admin.from('sites').select('id, name, domain').order('name', { ascending: true });
  sites = siteRows || [];
  if (siteIdFilter) {
    sites = sites.filter((s) => s.id === siteIdFilter);
    if (!sites.length) {
      sites = [{ id: siteIdFilter, name: '(bilinmeyen site)', domain: null }];
    }
  }

  /** @type {Record<string, number>} */
  const gOut = {};
  /** @type {Record<string, number>} */
  const gQ = {};
  /** @type {Record<string, number>} */
  const gSig = {};
  /** @type {Array<{site_id:string,site_label:string,outbox:any,offline_queue:any,marketing_signals_dispatch:any,queued_or_retry_hint:number,sample_queue_exports:any[]}>} */
  const sections = [];
  const sinceIso = new Date(Date.now() - WINDOW_MS[reconciliationWindow]).toISOString();

  for (const s of sites) {
    const sid = s.id;
    let obRows = [];
    let qRows = [];
    let sigRows = [];
    let samples = [];
    let recoRows = [];
    try {
      obRows = await fetchSiteFieldPages(admin, 'outbox_events', sid, 'status');
    } catch {
      console.warn('[rapor] outbox_events site', sid.slice(0, 8));
    }
    try {
      qRows = await fetchSiteFieldPages(admin, 'offline_conversion_queue', sid, 'status');
    } catch {
      console.warn('[rapor] offline_conversion_queue site', sid.slice(0, 8));
    }
    try {
      sigRows = await fetchSiteFieldPages(admin, 'marketing_signals', sid, 'dispatch_status');
    } catch {
      console.warn('[rapor] marketing_signals site', sid.slice(0, 8));
    }
    try {
      samples = await fetchQueueSamples(admin, sid, 8);
    } catch {
      samples = [];
    }
    try {
      recoRows = await fetchSiteFieldPagesSince(admin, 'oci_reconciliation_events', sid, 'reason', sinceIso);
    } catch {
      recoRows = [];
    }

    const outbox = countBy(obRows, 'status');
    const offline_queue = countBy(qRows, 'status');
    const marketing_signals_dispatch = countBy(sigRows, 'dispatch_status');
    const queued_or_retry_hint = ['QUEUED', 'RETRY'].reduce((acc, st) => acc + (offline_queue[st] || 0), 0);
    const reconciliation_by_reason = Object.fromEntries(
      Object.values(OCI_RECONCILIATION_REASONS).map((reason) => [reason, 0])
    );
    for (const row of recoRows) {
      const reason = String(row.reason ?? 'UNKNOWN');
      reconciliation_by_reason[reason] = (reconciliation_by_reason[reason] || 0) + 1;
    }

    for (const [k, v] of Object.entries(outbox)) gOut[k] = (gOut[k] || 0) + v;
    for (const [k, v] of Object.entries(offline_queue)) gQ[k] = (gQ[k] || 0) + v;
    for (const [k, v] of Object.entries(marketing_signals_dispatch)) gSig[k] = (gSig[k] || 0) + v;

    const hasAny = obRows.length + qRows.length + sigRows.length > 0;
    if (siteIdFilter || hasAny) {
      sections.push({
        site_id: sid,
        site_label: `${s.name || sid}${s.domain ? ` (${s.domain})` : ''}`,
        outbox,
        offline_queue,
        marketing_signals_dispatch,
        reconciliation_window: reconciliationWindow,
        reconciliation_by_reason,
        queued_or_retry_hint,
        sample_queue_exports: samples.map((r) => ({ id: r.id, status: r.status, call_id: r.call_id })),
      });
    }
  }

  const globalSummary = {
    outbox_total_status: gOut,
    queue_total_status: gQ,
    signals_total_dispatch: gSig,
    site_count_sections: sections.length,
  };

  const totalsOb = Object.values(gOut).reduce((a, b) => a + b, 0);
  const totalsQ = Object.values(gQ).reduce((a, b) => a + b, 0);
  const totalsS = Object.values(gSig).reduce((a, b) => a + b, 0);

  return {
    sections,
    globalSummary,
    totals: {
      sites_scanned: sites.length,
      outbox_rows_rollup: totalsOb,
      queue_rows_rollup: totalsQ,
      signals_rows_rollup: totalsS,
    },
  };
}

async function main() {
  if (!url || !key) {
    console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY (.env.local)');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));

  console.log('='.repeat(60));
  console.log('OCI pipeline — fill + drain + rapor');
  console.log('='.repeat(60));

  if (!args.noBackfill) {
    console.log('\n[A] Backfill (outbox_events eksikleri)...\n');
    const scriptPath = join(__dirname, 'oci-outbox-missed-backfill.mjs');
    const spawnArgs = [scriptPath];
    if (args.site) spawnArgs.push(args.site);
    else spawnArgs.push('--all-sites');
    spawnArgs.push('--apply');
    const proc = spawnSync(process.execPath, spawnArgs, {
      stdio: 'inherit',
      env: process.env,
      cwd: join(__dirname, '..', '..'),
    });
    if (proc.status !== 0) {
      console.error('[A] Backfill çıkış kodu:', proc.status);
      process.exit(proc.status ?? 1);
    }
  } else {
    console.log('\n[A] Backfill atlandı (--no-backfill)\n');
  }

  let drainResult = null;
  if (!args.noDrain) {
    console.log(args.useCronLock ? '\n[B] Drain (cron lock safety-net)...\n' : '\n[B] Drain (worker-first)...\n');
    drainResult = await drainOutboxOverHttp(args.maxBatches, args.useCronLock);
    if (drainResult.skipped) {
      console.warn('[B] Drain:', drainResult.reason);
    } else if (!drainResult.ok) {
      console.error('[B] Drain hata ile bitti.');
    } else {
      console.log(
        '[B] Toplam claim işlenen batch özeti:',
        'claimed≈',
        drainResult.totalClaimed,
        'processed≈',
        drainResult.totalProcessed,
        'round_count',
        drainResult.rounds?.length ?? 0
      );
      const lastFew = drainResult.rounds.slice(-5);
      for (const rr of lastFew) {
        console.log('    round', rr.round, 'status=', rr.status, 'claimed=', rr.claimed, 'processed=', rr.processed, rr.message || '');
      }
    }
  } else {
    console.log('\n[B] Drain atlandı (--no-drain)\n');
  }

  console.log('\n[C] Şema özeti rapor\n');
  const report = await buildReport(args.site, args.reconciliationWindow);

  if (args.json) {
    console.log(JSON.stringify({ drain: drainResult, report }, null, 2));
    return;
  }

  console.log('Toplam tablo örneklem satırları:', report.totals);
  console.log('\n──────────────────────────────────────────────────────────');
  if (!args.site) {
    const g = report.globalSummary;
    console.log('[Global] outbox:', g.outbox_total_status);
    console.log('[Global] offline_conversion_queue:', g.queue_total_status);
    console.log('[Global] marketing_signals dispatch_status:', g.signals_total_dispatch);
  }

  for (const sec of report.sections || []) {
    console.log('\n── Site ──', sec.site_label);
    console.log('  outbox_events (status):', sec.outbox);
    console.log('  offline_conversion_queue (status):', sec.offline_queue);
    console.log('  marketing_signals (dispatch_status):', sec.marketing_signals_dispatch);
    console.log(`  reconciliation (${sec.reconciliation_window}) by reason:`, sec.reconciliation_by_reason);
    console.log('  Script export için sıra ipucu (QUEUED+RETRY):', sec.queued_or_retry_hint);
    if (sec.sample_queue_exports?.length) {
      console.log('  Örnek sıradaki queue id / call_id:');
      for (const sx of sec.sample_queue_exports) {
        console.log('     ', sx.id, sx.status, sx.call_id);
      }
    }
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('Akış özeti');
  console.log('  Panel/RPC sonrası: outbox_events (PENDING)');
  console.log('  İşçi (cron/QStash): PENDING→PROCESS→marketing_signals veya Won→offline_conversion_queue');
  console.log('  Google Ads script PEEK: /api/oci/google-ads-export içinde QUEUED+sinyaller (outbox doğrudan sayılmaz)');
  console.log('  Drain için .env.local: BASE_URL (veya NEXT_PUBLIC_APP_URL) = prod origin; CRON_SECRET gerekir.');
  console.log('  Varsayılan drain worker endpointini kullanır; cron lock yolu için --use-cron-lock ver.');
  console.log('  Tek komut (backfill+drain+rapor): npm run db:oci-pipeline-sync');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
