#!/usr/bin/env node
/**
 * PR-A0: Read-only storage retention audit → tmp/storage-audit.json
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key);

async function countTable(table, filter) {
  let q = admin.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const since31m = new Date(Date.now() - 31 * 60 * 1000).toISOString();

  const [
    processedByStatus,
    staleProcessing,
    outboxOld,
    queueOld,
    heartbeats,
    sessionsProbe,
    ledgerProbe,
  ] = await Promise.all([
    admin.from('processed_signals').select('status'),
    countTable('processed_signals', (q) =>
      q.eq('status', 'processing').lt('created_at', since31m)
    ),
    countTable('outbox_events', (q) =>
      q.eq('status', 'PROCESSED').lt('processed_at', since7d)
    ),
    countTable('offline_conversion_queue', (q) =>
      q.in('status', ['COMPLETED', 'FATAL', 'FAILED']).lt('updated_at', since90d)
    ),
    admin.from('cron_job_heartbeats').select('*').order('last_finished_at', { ascending: false }),
    admin
      .from('sessions')
      .select('id, created_at, traffic_v2_ledger, traffic_source, attribution_source')
      .order('created_at', { ascending: false })
      .limit(5),
    admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .not('traffic_v2_ledger', 'is', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const statusCounts = {};
  for (const row of processedByStatus.data ?? []) {
    const s = row.status ?? 'unknown';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  const total24h = await countTable('sessions');
  const withLedger24h = ledgerProbe.count ?? 0;
  const totalSessions24h = total24h.count ?? 0;

  const report = {
    generated_at: generatedAt,
    decision_label: 'STORAGE_RETENTION_KERNEL_AUDIT_FIRST_APPROVED',
    env_flags: {
      SOURCE_TRUTH_SHADOW_ENABLED: process.env.SOURCE_TRUTH_SHADOW_ENABLED ?? null,
      TRUTH_SHADOW_WRITE_ENABLED: process.env.TRUTH_SHADOW_WRITE_ENABLED ?? null,
      OPSMANTIK_STORAGE_CLEANUP_APPROVAL: process.env.OPSMANTIK_STORAGE_CLEANUP_APPROVAL
        ? '(set)'
        : '(unset)',
    },
    pg_stat_statements: 'run scripts/sql/storage_audit.sql in SQL Editor for top queries',
    tables_note: 'run storage_audit.sql section 1 for byte sizes',
    backlog: {
      processed_signals_by_status: statusCounts,
      processed_signals_stale_processing: staleProcessing.count ?? staleProcessing.error,
      outbox_processed_older_than_7d: outboxOld.count ?? outboxOld.error,
      queue_terminal_older_than_90d: queueOld.count ?? queueOld.error,
      sessions_24h: totalSessions24h,
      sessions_with_v2_ledger_24h: withLedger24h,
      v2_fill_rate_24h_pct:
        totalSessions24h > 0 ? ((withLedger24h / totalSessions24h) * 100).toFixed(1) : '0',
    },
    cron_heartbeats: heartbeats.data ?? [],
    latest_sessions_sample: sessionsProbe.data ?? [],
    recommendations: [],
  };

  if ((outboxOld.count ?? 0) > 1000) {
    report.recommendations.push({ id: 'R-P0-2', action: 'PR-B1 outbox index + batch cleanup' });
  }
  if ((staleProcessing.count ?? 0) > 0) {
    report.recommendations.push({ id: 'R-P1-3', action: 'PR-C1 processed_signals stale fail' });
  }
  if ((queueOld.count ?? 0) > 5000) {
    report.recommendations.push({ id: 'R-P0-3', action: 'PR-C2 OCI queue cleanup smaller batches' });
  }

  const outDir = join(process.cwd(), 'tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `storage-audit-${generatedAt.slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nWrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
