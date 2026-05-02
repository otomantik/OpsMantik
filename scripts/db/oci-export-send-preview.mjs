#!/usr/bin/env node
/**
 * Google Ads script'in GET export ile göreceği satırların okunabilir özeti (DB doğrudan).
 * Filtreler export-fetch ile aynı: queue QUEUED|RETRY, signals PENDING, provider_key google_ads.
 *
 *   node scripts/db/oci-export-send-preview.mjs 7eb8f5c0-...
 *   node scripts/db/oci-export-send-preview.mjs Muratcan
 *   node scripts/db/oci-export-send-preview.mjs --all-sites
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv) {
  const allSites = argv.includes('--all-sites');
  let siteQ = null;
  for (const a of argv) {
    if (a === '--all-sites') continue;
    if (a.startsWith('-')) continue;
    siteQ = a;
    break;
  }
  if (allSites) siteQ = null;
  return { allSites, siteQ };
}

function majors(cents, cur) {
  if (cents == null || !Number.isFinite(Number(cents))) return '—';
  const major = Number(cents) / 100;
  return `${major.toFixed(2)} ${cur || 'TRY'}`;
}

function shortClick(g, w, gb) {
  const pick = g || w || gb || '';
  if (!pick) return '—';
  return String(pick).slice(0, 18) + (String(pick).length > 18 ? '…' : '');
}

async function resolveSiteIds(supabase, allSites, siteQ) {
  if (allSites) {
    const { data, error } = await supabase.from('sites').select('id, name, domain').order('name');
    if (error) throw error;
    return data || [];
  }
  if (!siteQ) {
    console.error('Site id, ad veya --all-sites verin.');
    process.exit(1);
  }
  const uuidRegex = /^[0-9a-f-]{36}$/i;
  if (uuidRegex.test(siteQ)) {
    const { data } = await supabase.from('sites').select('id, name, domain').eq('id', siteQ).maybeSingle();
    if (data) return [data];
    return [{ id: siteQ, name: '?', domain: null }];
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name, domain')
    .or(`name.ilike.%${siteQ}%,domain.ilike.%${siteQ}%`)
    .limit(25);
  if (!data?.length) {
    console.error('Site bulunamadı:', siteQ);
    process.exit(1);
  }
  return data;
}

async function loadQueue(supabase, siteId) {
  const { data, error } = await supabase
    .from('offline_conversion_queue')
    .select(
      'id, call_id, action, conversion_time, occurred_at, value_cents, currency, external_id, gclid, wbraid, gbraid, status, optimization_stage, updated_at'
    )
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .in('status', ['QUEUED', 'RETRY'])
    .order('updated_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

async function loadSignals(supabase, siteId) {
  const { data, error } = await supabase
    .from('marketing_signals')
    .select(
      'id, call_id, signal_type, optimization_stage, google_conversion_name, google_conversion_time, occurred_at, conversion_value, optimization_value, gclid, wbraid, gbraid, dispatch_status, created_at'
    )
    .eq('site_id', siteId)
    .eq('dispatch_status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

async function loadOutboxPending(supabase, siteId) {
  const { data, error } = await supabase
    .from('outbox_events')
    .select('id, status, call_id, payload, created_at')
    .eq('site_id', siteId)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) return { rows: [], err: error.message };
  return { rows: data || [], err: null };
}

async function main() {
  if (!url || !key) {
    console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const args = parseArgs(process.argv.slice(2));
  const sites = await resolveSiteIds(supabase, args.allSites, args.siteQ);

  console.log('='.repeat(72));
  console.log('OCI — Gönderime aday dönüşümler (export API ile uyumlu filtre)');
  console.log('='.repeat(72));
  console.log('');
  console.log(
    'Not: Tek lead için Won kuyruk + düşük huni sinyalleri aynı export turunda gelebilir; sunucuda ' +
      '`selectHighestPriorityCandidates` yalnızca en yüksek önceliği script’e bırakır (PEEK/suppressed uyarısı).'
  );
  console.log('');

  let gq = 0;
  let gs = 0;
  let go = 0;

  for (const site of sites) {
    const sid = site.id;
    const label = `${site.name || sid}${site.domain ? ` (${site.domain})` : ''}`;

    const [queue, signals, outboxPending] = await Promise.all([
      loadQueue(supabase, sid),
      loadSignals(supabase, sid),
      loadOutboxPending(supabase, sid),
    ]);

    gq += queue.length;
    gs += signals.length;
    go += outboxPending.rows.length;

    if (queue.length + signals.length + outboxPending.rows.length === 0 && !args.allSites) {
      console.log(`── ${label}`);
      console.log('  (bu sitede export kuyruğunda/satırda aday yok)');
      console.log('');
      continue;
    }
    if (queue.length + signals.length + outboxPending.rows.length === 0 && args.allSites) {
      continue;
    }

    console.log(`──────────────────────────────────────────────────────────────────────────`);
    console.log(`Site: ${label}`);
    console.log(`  UUID: ${sid}`);
    console.log('');

    if (outboxPending.err) {
      console.log(`  [Outbox PENDING okunamadı: ${outboxPending.err}]`);
    } else if (outboxPending.rows.length) {
      console.log(`  Bekleyen outbox_events (işçi tüketince kuyruk/sinyal oluşur): ${outboxPending.rows.length}`);
      for (const r of outboxPending.rows) {
        const p = r.payload && typeof r.payload === 'object' ? r.payload : {};
        const cid = r.call_id || p.call_id || '—';
        const stage = p.stage ?? '—';
        const cur = (p.currency && String(p.currency)) || 'TRY';
        const sale = p.sale_amount != null ? String(p.sale_amount) : '—';
        const conf = (p.confirmed_at && String(p.confirmed_at).slice(0, 19)) || '—';
        console.log(
          `     • id=${r.id.slice(0, 8)}… call=${cid} stage=${stage} sale=${sale} ${cur} confirmed≈${conf}`
        );
      }
      console.log('');
    }

    console.log(`  [A] offline_conversion_queue (QUEUED | RETRY) — Won / seal yolu · ${queue.length} satır`);
    for (const r of queue) {
      const val = majors(r.value_cents, r.currency);
      console.log(
        `      ${r.id} | call=${r.call_id ?? '—'} | ${r.action ?? '—'} | ${val}` +
          ` | conv_time=${r.conversion_time ?? r.occurred_at ?? '—'}` +
          ` | click=${shortClick(r.gclid, r.wbraid, r.gbraid)}` +
          ` | ext=${(r.external_id || '').slice(0, 40)} | st=${r.status}`
      );
    }
    console.log('');

    console.log(`  [B] marketing_signals (PENDING) — üst huni / optimization · ${signals.length} satır`);
    for (const r of signals) {
      const val =
        r.conversion_value != null
          ? String(r.conversion_value)
          : r.optimization_value != null
            ? String(r.optimization_value)
            : '—';
      console.log(
        `      ${r.id} | call=${r.call_id ?? '—'} | ${r.google_conversion_name ?? r.signal_type}` +
          ` | stage=${r.optimization_stage ?? r.signal_type ?? '—'}` +
          ` | val=${val}` +
          ` | time=${r.google_conversion_time ?? r.occurred_at ?? '—'}` +
          ` | click=${shortClick(r.gclid, r.wbraid, r.gbraid)}`
      );
    }
    console.log('');
  }

  console.log('='.repeat(72));
  console.log('Özet (tüm listelenen siteler)');
  console.log(`  offline_conversion_queue export adayları: ${gq}`);
  console.log(`  marketing_signals PENDING: ${gs}`);
  console.log(`  outbox_events PENDING (işçi bekliyor): ${go}`);
  console.log('='.repeat(72));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
