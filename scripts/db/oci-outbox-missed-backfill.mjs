#!/usr/bin/env node
/**
 * Seal/stage öncesi bug nedeniyle hiç yazılmamış `outbox_events` satırlarını doldurur.
 * `enqueuePanelStageOciOutbox` ile aynı kurallar: export edilebilir status + matched_session
 * + gerçek Ads click id (test pattern değil).
 *
 * Idempotent yaklaşım:
 *   - Aynı çağrı için zaten PENDING/PROCESSING outbox varsa atlar.
 *   - won (confirmed/qualified/real dahil): aktif offline_conversion_queue satırı varsa atlar.
 *   - contacted/offered/junk: aynı çağrı için ilgili stage’de halihazırda marketing_signals varsa atlar.
 *
 * Kullanım:
 *   node scripts/db/oci-outbox-missed-backfill.mjs Muratcan
 *   node scripts/db/oci-outbox-missed-backfill.mjs 7eb8f5c0-4a96-4a0e-bd89-a463127b26b8 --dry-run
 *   node scripts/db/oci-outbox-missed-backfill.mjs Muratcan --apply
 *   node scripts/db/oci-outbox-missed-backfill.mjs Muratcan --apply --since=2026-04-01 --limit=200
 *   (--since: calls.created_at üzerinden)
 *   calls satırları `select('*')` ile çekilir (sale_amount / sale_* / updated_at eksik eski şemalarda
 *   sabit kolon listesi 42703 hatası vermez; payload’da olmayan alanlar null kalır).
 *   node scripts/db/oci-outbox-missed-backfill.mjs Muratcan --apply --trigger   # CRON_SECRET + BASE_URL ile worker tetikler
 *   node scripts/db/oci-outbox-missed-backfill.mjs --all-sites --dry-run       # tüm tenants (liste `sites`)
 *   node scripts/db/oci-outbox-missed-backfill.mjs --all-sites --apply --trigger
 *
 * Outbox insert sonrası işlem için (deploy ortamında):
 *   node scripts/trigger_outbox_processor.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_SUBSTRINGS = ['TEST_GCLID', 'TEST_GBRAID', 'TEST_WBRAID', 'E2E_CLICK', 'SMOKE_GCLID'];

const EXPORT_STATUSES = ['junk', 'contacted', 'offered', 'won', 'confirmed', 'qualified', 'real'];

const ACTIVE_OCQ_STATUSES = ['QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'COMPLETED', 'COMPLETED_UNVERIFIED'];

function trimClick(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

function sessionHasAdsClick(row) {
  return trimClick(row?.gclid) || trimClick(row?.wbraid) || trimClick(row?.gbraid);
}

function isLikelyTestClick(row) {
  for (const raw of [row?.gclid, row?.wbraid, row?.gbraid]) {
    const v = trimClick(raw);
    if (!v) continue;
    const u = v.toUpperCase();
    for (const m of TEST_SUBSTRINGS) {
      if (u.includes(m)) return true;
    }
  }
  return false;
}

function resolveOciStage(status) {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'junk') return 'junk';
  if (s === 'contacted') return 'contacted';
  if (s === 'offered') return 'offered';
  if (s === 'won' || s === 'confirmed' || s === 'qualified' || s === 'real') return 'won';
  return null;
}

function parseArgs(argv) {
  const out = {
    apply: false,
    dryRun: true,
    trigger: false,
    since: null,
    limit: null,
    siteQuery: null,
    allSites: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all-sites') {
      out.allSites = true;
      continue;
    }
    if (a === '--apply') {
      out.apply = true;
      out.dryRun = false;
      continue;
    }
    if (a === '--dry-run' || a === '-n') {
      out.dryRun = true;
      out.apply = false;
      continue;
    }
    if (a === '--trigger') {
      out.trigger = true;
      continue;
    }
    if (a.startsWith('--since=')) {
      out.since = a.slice('--since='.length).trim();
      continue;
    }
    if (a === '--since') {
      out.since = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (a.startsWith('--limit=')) {
      const n = parseInt(a.split('=')[1], 10);
      out.limit = Number.isFinite(n) && n > 0 ? n : null;
      continue;
    }
    if (a === '--limit') {
      const n = parseInt(argv[i + 1], 10);
      out.limit = Number.isFinite(n) && n > 0 ? n : null;
      i += 1;
      continue;
    }
    if (!a.startsWith('-')) {
      out.siteQuery = a;
    }
  }
  return out;
}

async function resolveSiteId(supabase, q) {
  if (!q) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(q)) {
    const { data } = await supabase.from('sites').select('id, name').eq('id', q).maybeSingle();
    return data?.id || null;
  }
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    .limit(1);
  return data?.[0]?.id || null;
}

function buildPayload(call, stage) {
  const nowIso = new Date().toISOString();
  const wonLike = stage === 'won';
  const confirmedAt =
    (wonLike ? call.confirmed_at : null) ??
    (typeof call.updated_at === 'string' ? call.updated_at : null) ??
    (typeof call.created_at === 'string' ? call.created_at : null) ??
    nowIso;
  const curRaw = call.currency != null ? String(call.currency) : 'TRY';
  const currency = curRaw.trim() || 'TRY';
  return {
    call_id: call.id,
    site_id: call.site_id,
    lead_score: call.lead_score ?? null,
    stage,
    confirmed_at: confirmedAt,
    created_at: call.created_at ?? confirmedAt,
    sale_occurred_at: call.sale_occurred_at ?? null,
    sale_source_timestamp: call.sale_source_timestamp ?? null,
    sale_time_confidence: call.sale_time_confidence ?? null,
    sale_occurred_at_source: call.sale_occurred_at_source ?? null,
    sale_entry_reason: call.sale_entry_reason ?? null,
    sale_amount: call.sale_amount ?? null,
    currency,
  };
}

async function hasPendingOutbox(supabase, callId) {
  const { data, error } = await supabase
    .from('outbox_events')
    .select('id')
    .eq('call_id', callId)
    .in('status', ['PENDING', 'PROCESSING'])
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function hasActiveOfflineQueue(supabase, siteId, callId) {
  const { data, error } = await supabase
    .from('offline_conversion_queue')
    .select('id, status')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .in('status', ACTIVE_OCQ_STATUSES)
    .limit(3);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function hasExistingSignalForStage(supabase, siteId, callId, stage) {
  const { data, error } = await supabase
    .from('marketing_signals')
    .select('id, optimization_stage, signal_type')
    .eq('site_id', siteId)
    .eq('call_id', callId)
    .limit(50);
  if (error) throw error;
  const st = stage.toLowerCase();
  for (const row of data || []) {
    const os = String(row.optimization_stage ?? '').toLowerCase();
    const sig = String(row.signal_type ?? '').toLowerCase();
    if (os === st || sig === st) return true;
  }
  return false;
}

async function shouldSkip({ supabase, siteId, call, stage }) {
  if (await hasPendingOutbox(supabase, call.id)) {
    return { skip: true, reason: 'pending_outbox' };
  }
  if (stage === 'won') {
    if (await hasActiveOfflineQueue(supabase, siteId, call.id)) {
      return { skip: true, reason: 'offline_queue_active' };
    }
  } else {
    if (await hasExistingSignalForStage(supabase, siteId, call.id, stage)) {
      return { skip: true, reason: 'marketing_signal_exists' };
    }
  }
  return { skip: false };
}

async function triggerOutboxCron() {
  const secret = process.env.CRON_SECRET;
  const base =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!secret || !base) {
    console.warn(
      '[trigger] CRON_SECRET veya BASE_URL/NEXT_PUBLIC_APP_URL eksik; outbox worker tetiklenmedi. Manuel: node scripts/trigger_outbox_processor.mjs'
    );
    return false;
  }
  const workerUrl = `${String(base).replace(/\/$/, '')}/api/workers/oci/process-outbox`;
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'x-opsmantik-internal-worker': '1',
    },
  });
  const text = await res.text();
  console.log('[trigger] POST', workerUrl, '→', res.status, text.slice(0, 500));
  return res.ok;
}

async function main() {
  if (!url || !key) {
    console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY (.env.local)');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const args = parseArgs(process.argv.slice(2));

  if (args.allSites && args.siteQuery) {
    console.error('--all-sites ile birlikte site adı/id verme; tek tenant için positional arg kullan.');
    process.exit(1);
  }

  /** @type {Array<{ id: string, name?: string | null, domain?: string | null }>} */
  let siteTargets = [];
  if (args.allSites) {
    const { data: allRows, error: allErr } = await supabase.from('sites').select('id, name, domain').order('domain', { ascending: true });
    if (allErr) {
      console.error('sites çekilemedi:', allErr.message);
      process.exit(1);
    }
    siteTargets = allRows || [];
    if (!siteTargets.length) {
      console.error('sites tablosu boş');
      process.exit(1);
    }
    console.log('Tüm siteler:', siteTargets.length, 'tenant');
  } else {
    const siteId = await resolveSiteId(supabase, args.siteQuery);
    if (!siteId) {
      console.error(
        'Site bulunamadı. Örnek: node scripts/db/oci-outbox-missed-backfill.mjs Muratcan\n' +
          '  veya çok kiracılı: ... --all-sites --dry-run'
      );
      process.exit(1);
    }
    const { data: one } = await supabase.from('sites').select('id, name, domain').eq('id', siteId).maybeSingle();
    siteTargets = one ? [one] : [{ id: siteId, name: null, domain: null }];
  }

  console.log('Mod:', args.apply ? 'APPLY (yazılacak)' : 'DRY-RUN (sadece rapor)');
  if (args.since) console.log('since created_at >=', args.since);
  if (args.limit) console.log('limit', args.limit);

  let grandTotalInserted = 0;

  for (const siteMeta of siteTargets) {
    const siteId = siteMeta.id;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(
      'Site:',
      siteMeta?.name ?? siteId,
      siteMeta?.domain ? `(${siteMeta.domain})` : '',
      `\nUUID: ${siteId}`
    );

  let q = supabase
    .from('calls')
    .select('*')
    .eq('site_id', siteId)
    .not('matched_session_id', 'is', null)
    .in('status', EXPORT_STATUSES)
    .order('created_at', { ascending: false });

  if (args.since) {
    q = q.gte('created_at', args.since);
  }
  if (args.limit) {
    q = q.limit(args.limit);
  }

  const { data: calls, error: callsErr } = await q;
  if (callsErr) {
    console.error('calls okunamadı:', callsErr.message);
    process.exit(1);
  }

  const sessionIds = [...new Set((calls || []).map((c) => c.matched_session_id).filter(Boolean))];
  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, gclid, wbraid, gbraid')
    .eq('site_id', siteId)
    .in('id', sessionIds);

  if (sessErr) {
    console.error('sessions okunamadı:', sessErr.message);
    process.exit(1);
  }

  const sessionMap = new Map((sessions || []).map((s) => [s.id, s]));

  let eligible = 0;
  let skipped = 0;
  let inserted = 0;
  const skipReasons = {};

  for (const call of calls || []) {
    const stage = resolveOciStage(call.status);
    if (!stage) continue;

    const sess = call.matched_session_id ? sessionMap.get(call.matched_session_id) : null;
    if (!sess) {
      skipped += 1;
      skipReasons.session_missing = (skipReasons.session_missing || 0) + 1;
      continue;
    }
    if (isLikelyTestClick(sess)) {
      skipped += 1;
      skipReasons.test_click = (skipReasons.test_click || 0) + 1;
      continue;
    }
    if (!sessionHasAdsClick(sess)) {
      skipped += 1;
      skipReasons.no_click_id = (skipReasons.no_click_id || 0) + 1;
      continue;
    }

    const { skip, reason } = await shouldSkip({ supabase, siteId, call, stage });
    if (skip) {
      skipped += 1;
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      continue;
    }

    eligible += 1;
    const payload = buildPayload(call, stage);

    if (args.dryRun) {
      console.log('[dry-run] eklenecek', call.id, 'stage=', stage, 'status=', call.status);
      continue;
    }

    const { error: insErr } = await supabase.from('outbox_events').insert({
      event_type: 'IntentSealed',
      call_id: call.id,
      site_id: siteId,
      status: 'PENDING',
      payload,
    });

    if (insErr) {
      console.error('[hata]', call.id, insErr.message);
      skipReasons.insert_error = (skipReasons.insert_error || 0) + 1;
    } else {
      inserted += 1;
      console.log('[ok]', call.id, stage);
    }
  }

  console.log('\n--- Site özeti ---');
  console.log('Aday çağrı (export status + session):', (calls || []).length);
  console.log('Pipeline kurallarından sonra eklenebilir:', eligible);
  console.log('Atlanan:', skipped, skipReasons);
  if (args.apply) {
    console.log('Insert edilen outbox satırı:', inserted);
    grandTotalInserted += inserted;
  }
  }

  console.log('\n════════ GENEL ════════');
  console.log('İşlenen tenant sayısı:', siteTargets.length);
  if (args.apply) {
    console.log('Toplam insert (tüm siteler):', grandTotalInserted);
  }

  if (args.apply && args.trigger && grandTotalInserted > 0) {
    await triggerOutboxCron();
  } else if (args.apply && grandTotalInserted > 0) {
    console.log('\nOutbox işlemesi için: node scripts/trigger_outbox_processor.mjs');
    console.log('  (veya --apply --trigger ile CRON_SECRET + BASE_URL kullan)');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
