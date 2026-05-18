#!/usr/bin/env node
/**
 * Verify Source Truth shadow: column exists + recent ledger fill rate.
 * Loads .env.local if present.
 */
import { readFileSync, existsSync } from 'node:fs';
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

const flag = process.env.SOURCE_TRUTH_SHADOW_ENABLED;
console.log('SOURCE_TRUTH_SHADOW_ENABLED (local env):', flag ?? '(unset → false at runtime)');

// Column probe via select
const { data: probe, error: probeErr } = await admin
  .from('sessions')
  .select('id, created_at, traffic_v2_ledger, traffic_source, attribution_source')
  .order('created_at', { ascending: false })
  .limit(5);

if (probeErr) {
  if (probeErr.message?.includes('traffic_v2_ledger') || probeErr.code === '42703') {
    console.log('\n❌ Column traffic_v2_ledger MISSING — apply migration 20261231130300');
    process.exit(1);
  }
  console.error('Probe error:', probeErr.message);
  process.exit(1);
}

console.log('\n✅ Column traffic_v2_ledger exists');

const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { count: total24h, error: c1 } = await admin
  .from('sessions')
  .select('id', { count: 'exact', head: true })
  .gte('created_at', since);

const { count: withLedger24h, error: c2 } = await admin
  .from('sessions')
  .select('id', { count: 'exact', head: true })
  .gte('created_at', since)
  .not('traffic_v2_ledger', 'is', null);

if (c1 || c2) {
  console.error('Count error:', c1?.message || c2?.message);
  process.exit(1);
}

console.log(`\nLast 24h sessions: ${total24h ?? 0}`);
console.log(`With traffic_v2_ledger: ${withLedger24h ?? 0}`);
const rate = total24h ? ((withLedger24h ?? 0) / total24h * 100).toFixed(1) : '0';
console.log(`Fill rate: ${rate}%`);

console.log('\n--- Latest 5 sessions ---');
for (const row of probe ?? []) {
  const ledger = row.traffic_v2_ledger;
  const ch = ledger && typeof ledger === 'object' ? ledger.channel : null;
  const paid = ledger && typeof ledger === 'object' ? ledger.is_paid : null;
  console.log({
    id: row.id?.slice(0, 8),
    created_at: row.created_at,
    legacy_traffic: row.traffic_source,
    legacy_attr: row.attribution_source,
    v2_channel: ch ?? '(empty)',
    v2_is_paid: paid ?? '(empty)',
  });
}

if ((withLedger24h ?? 0) === 0 && (total24h ?? 0) > 0) {
  console.log('\n⚠️  No ledgers in 24h. Check:');
  console.log('  - Vercel deploy includes commit 4d5b094+');
  console.log('  - SOURCE_TRUTH_SHADOW_ENABLED=true on that environment');
  console.log('  - New traffic after deploy (old sessions are not backfilled)');
}
