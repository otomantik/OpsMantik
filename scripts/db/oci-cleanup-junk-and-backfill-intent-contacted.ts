/**
 * 1) (İsteğe bağlı) Junk / cancelled click çağrılarını ve ilişkili marketing_signals / offline_conversion_queue temizler.
 * 2) `intent` + (session veya çağrı satırında) Ads click id olan ve henüz OpsMantik_Contacted olmayan kayıtlar için
 *    `marketing_signals` (PENDING) üretir — Tecrübeli Bakıcı vb. Google Ads script birleşik export bunları çeker.
 *
 * Flags:
 *   --dry-run              Silme/insert yok; contacted adaylarını listeler.
 *   --report-only          Sadece özet rapor + public_id (Google Script OPSMANTIK_SITE_ID); DB değişmez.
 *   --skip-junk-delete     Junk/cancelled silme adımını atlar (yalnızca contacted backfill).
 *   --all-sources          Intent listesinde source=click filtresini kaldırır (Tecrübeli gibi tenantlar).
 *
 * Usage:
 *   npx tsx scripts/db/oci-cleanup-junk-and-backfill-intent-contacted.ts "Tecrübeli" --report-only
 *   npx tsx scripts/db/oci-cleanup-junk-and-backfill-intent-contacted.ts "Tecrübeli" --dry-run
 *   npx tsx scripts/db/oci-cleanup-junk-and-backfill-intent-contacted.ts <SITE_UUID>
 *
 * Requires .env.local (SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL).
 */
import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { upsertMarketingSignal } from '@/lib/domain/mizan-mantik/upsert-marketing-signal';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/domain/mizan-mantik/conversion-names';
import { buildOptimizationSnapshot } from '@/lib/oci/optimization-contract';
import { loadMarketingSignalEconomics } from '@/lib/oci/marketing-signal-value-ssot';
import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';

config({ path: join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Eksik: NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const reportOnly = args.includes('--report-only');
const skipJunkDelete = args.includes('--skip-junk-delete');
const allSources = args.includes('--all-sources');
const positional = args.find((a) => !a.startsWith('-'));

const CHUNK = 200;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function trimSeg(s: string | null | undefined): string {
  const v = typeof s === 'string' ? s.trim() : '';
  return v.length > 0 ? v : '';
}

/** ILIKE deseninde %/_ enjeksiyonunu kırp */
function safeIlikeToken(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/%/g, '').replace(/_/g, '').trim();
}

type ResolvedSite = { id: string; name: string; public_id: string | null };

async function resolveSiteId(q: string | undefined): Promise<ResolvedSite | null> {
  if (!q) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(q)) {
    const { data } = await supabase.from('sites').select('id, name, public_id').eq('id', q).maybeSingle();
    return data ? { id: data.id, name: data.name, public_id: (data as { public_id?: string }).public_id ?? null } : null;
  }

  const token = safeIlikeToken(q);
  if (!token) return null;

  const { data: rows, error } = await supabase
    .from('sites')
    .select('id, name, public_id, domain')
    .or(`name.ilike.%${token}%,domain.ilike.%${token}%`)
    .limit(25);

  if (error || !rows?.length) return null;

  if (rows.length === 1) {
    const r = rows[0];
    return { id: r.id, name: r.name, public_id: (r as { public_id?: string }).public_id ?? null };
  }

  const qLower = q.trim().toLowerCase();
  const exact = rows.find((r) => (r.name ?? '').trim().toLowerCase() === qLower);
  if (exact) return { id: exact.id, name: exact.name, public_id: (exact as { public_id?: string }).public_id ?? null };

  const tecBak = rows.filter((r) => {
    const n = (r.name ?? '').toLowerCase();
    return n.includes('tecr') && n.includes('bak');
  });
  if (tecBak.length === 1) {
    const r = tecBak[0];
    return { id: r.id, name: r.name, public_id: (r as { public_id?: string }).public_id ?? null };
  }

  console.error('Birden fazla site eşleşti; tam UUID veya daha kesin arama kullanın:\n');
  for (const r of rows.slice(0, 12)) {
    const pid = (r as { public_id?: string }).public_id ?? '';
    console.error(`  ${r.id}  name=${r.name}  public_id=${pid}`);
  }
  if (rows.length > 12) console.error(`  ... +${rows.length - 12} daha`);
  process.exit(1);
}

interface SessionClick {
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
}

function effectiveClickFromSession(sess: SessionClick | undefined): SessionClick | null {
  if (!sess) return null;
  const g = trimSeg(sess.gclid);
  const w = trimSeg(sess.wbraid);
  const b = trimSeg(sess.gbraid);
  if (!g && !w && !b) return null;
  return { gclid: g || null, wbraid: w || null, gbraid: b || null };
}

function effectiveClickFromCall(row: {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  click_id?: string | null;
}): SessionClick | null {
  const g = trimSeg(row.gclid) || trimSeg(row.click_id);
  const w = trimSeg(row.wbraid);
  const b = trimSeg(row.gbraid);
  if (!g && !w && !b) return null;
  return { gclid: g || null, wbraid: w || null, gbraid: b || null };
}

/** Oturum öncelikli, yoksa çağrı satırı (export’taki primary_source mantığına yakın). */
function resolveEffectiveClick(
  row: {
    matched_session_id?: string | null;
    gclid?: string | null;
    wbraid?: string | null;
    gbraid?: string | null;
    click_id?: string | null;
  },
  sessionById: Map<string, SessionClick>
): { gclid: string | null; wbraid: string | null; gbraid: string | null; clickSource: 'session' | 'call' } | null {
  const sid = row.matched_session_id?.trim();
  if (sid) {
    const fromS = effectiveClickFromSession(sessionById.get(sid));
    if (fromS) return { ...fromS, clickSource: 'session' };
  }
  const fromC = effectiveClickFromCall(row);
  if (fromC) return { ...fromC, clickSource: 'call' };
  return null;
}

interface IntentRow {
  id: string;
  created_at: string;
  lead_score: number | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  clickSource: 'session' | 'call';
}

type IntentCallRaw = {
  id: string;
  created_at: string;
  lead_score: number | null;
  matched_session_id?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  click_id?: string | null;
  source?: string | null;
};

async function loadIntentRows(siteId: string, allSources: boolean): Promise<IntentCallRaw[]> {
  let q = supabase
    .from('calls')
    .select('id, created_at, lead_score, matched_session_id, gclid, wbraid, gbraid, click_id, source')
    .eq('site_id', siteId)
    .eq('status', 'intent')
    .is('merged_into_call_id', null);
  if (!allSources) q = q.eq('source', 'click');
  const { data, error } = await q;
  if (error) {
    console.error('Intent sorgusu hatası:', error.message);
    process.exit(1);
  }
  return (data ?? []) as IntentCallRaw[];
}

async function buildSessionMap(siteId: string, list: IntentCallRaw[]): Promise<Map<string, SessionClick>> {
  const sessionIds = [
    ...new Set(
      list
        .map((c) => c.matched_session_id)
        .filter((sid): sid is string => typeof sid === 'string' && sid.length > 0)
    ),
  ];
  const sessionById = new Map<string, SessionClick>();
  for (const part of chunks(sessionIds, CHUNK)) {
    const { data: sessRows, error: sErr } = await supabase
      .from('sessions')
      .select('id, gclid, wbraid, gbraid')
      .eq('site_id', siteId)
      .in('id', part);
    if (sErr) {
      console.error('sessions sorgusu hatası:', sErr.message);
      process.exit(1);
    }
    for (const s of sessRows ?? []) {
      sessionById.set(s.id as string, {
        gclid: (s as { gclid?: string | null }).gclid ?? null,
        wbraid: (s as { wbraid?: string | null }).wbraid ?? null,
        gbraid: (s as { gbraid?: string | null }).gbraid ?? null,
      });
    }
  }
  return sessionById;
}

async function printReport(site: ResolvedSite) {
  const { data: junkIds } = await supabase
    .from('calls')
    .select('id')
    .eq('site_id', site.id)
    .eq('source', 'click')
    .in('status', ['junk', 'cancelled']);

  const junkCount = (junkIds ?? []).length;

  const pipelineStatuses = [
    'intent',
    'contacted',
    'offered',
    'qualified',
    'real',
    'confirmed',
    'junk',
    'cancelled',
  ] as const;
  const statusCounts: Record<string, number> = {};
  for (const st of pipelineStatuses) {
    const { count } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .eq('status', st)
      .is('merged_into_call_id', null);
    statusCounts[st] = count ?? 0;
  }

  const list = await loadIntentRows(site.id, true);
  const bySource: Record<string, number> = {};
  for (const raw of list) {
    const k = (raw.source ?? '(null)').trim() || '(null)';
    bySource[k] = (bySource[k] ?? 0) + 1;
  }
  const sessionById = await buildSessionMap(site.id, list);

  let withSession = 0;
  let withoutSession = 0;
  let withEffectiveClick = 0;
  let sessionSource = 0;
  let callSource = 0;
  let noClick = 0;

  const candidateIds: string[] = [];
  const contactedName = OPSMANTIK_CONVERSION_NAMES.contacted;

  for (const raw of list) {
    const c = raw;
    if (c.matched_session_id?.trim()) withSession++;
    else withoutSession++;

    const eff = resolveEffectiveClick(c, sessionById);
    if (!eff) {
      noClick++;
      continue;
    }
    withEffectiveClick++;
    if (eff.clickSource === 'session') sessionSource++;
    else callSource++;
    candidateIds.push(c.id);
  }

  const alreadyContacted = new Set<string>();
  for (const part of chunks(candidateIds, CHUNK)) {
    const { data: msRows, error: msErr } = await supabase
      .from('marketing_signals')
      .select('call_id')
      .eq('site_id', site.id)
      .eq('google_conversion_name', contactedName)
      .in('call_id', part);
    if (msErr) {
      console.error('marketing_signals sorgusu hatası:', msErr.message);
      process.exit(1);
    }
    for (const r of msRows ?? []) {
      const cid = (r as { call_id?: string | null }).call_id;
      if (cid) alreadyContacted.add(cid);
    }
  }

  let toBackfill = 0;
  for (const id of candidateIds) {
    if (!alreadyContacted.has(id)) toBackfill++;
  }

  const { count: pendingContacted } = await supabase
    .from('marketing_signals')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id)
    .eq('google_conversion_name', contactedName)
    .in('dispatch_status', ['PENDING', 'RETRY']);

  const clickOnly = list.filter((r) => (r.source ?? '').trim().toLowerCase() === 'click');
  let clickOnlyBackfill = 0;
  if (clickOnly.length !== list.length) {
    const cCand: string[] = [];
    for (const raw of clickOnly) {
      if (resolveEffectiveClick(raw, sessionById)) cCand.push(raw.id);
    }
    const ac = new Set<string>();
    for (const part of chunks(cCand, CHUNK)) {
      const { data: msRows } = await supabase
        .from('marketing_signals')
        .select('call_id')
        .eq('site_id', site.id)
        .eq('google_conversion_name', contactedName)
        .in('call_id', part);
      for (const r of msRows ?? []) {
        const cid = (r as { call_id?: string | null }).call_id;
        if (cid) ac.add(cid);
      }
    }
    for (const id of cCand) {
      if (!ac.has(id)) clickOnlyBackfill++;
    }
  }

  console.log('\n── Rapor (intent → OCI / Tecrübeli Bakıcı hazırlık) ──');
  console.log('Site:', site.name);
  console.log('site.id (internal):', site.id);
  console.log('sites.public_id (Google Script OPSMANTIK_SITE_ID):', site.public_id ?? '(yok — panelden kontrol edin)');
  console.log('Junk+cancelled click çağrı:', junkCount);
  console.log('Çağrı status özeti (merge yok, tüm source):', statusCounts);
  console.log('Intent source dağılımı (tümü):', list.length ? bySource : '(intent yok)');
  console.log('Intent toplam (tüm source, merge yok):', list.length);
  console.log('  matched_session dolu:', withSession);
  console.log('  matched_session boş:', withoutSession);
  console.log('  Etkin Ads click id (session veya call):', withEffectiveClick, `(session=${sessionSource}, call=${callSource})`);
  console.log('  Ads click yok (OCI Contacted üretilemez):', noClick);
  console.log('Zaten OpsMantik_Contacted var (aday içinden):', alreadyContacted.size);
  console.log('Yeni eklenecek contacted adayı (--all-sources ile):', toBackfill);
  if (clickOnly.length !== list.length) {
    console.log('Karşılaştırma: source=click intent sayısı:', clickOnly.length, '| contacted adayı (yalnız click):', clickOnlyBackfill);
  }
  console.log('Şu an PENDING/RETRY OpsMantik_Contacted satırı:', pendingContacted ?? '?');
  console.log('Sonraki: npm run db:oci-intent-contacted:tecrubeli:dry → apply (veya --all-sources ile npx tsx ...)');
  console.log('Google Ads: scripts/google-ads-oci/GoogleAdsScriptTecrubeliBakici.js — public_id + oci_api_key doğrula.\n');
}

async function main() {
  const site = await resolveSiteId(positional);
  if (!site) {
    console.error('Site bulunamadı:', positional || '(boş)');
    process.exit(1);
  }

  if (reportOnly) {
    await printReport(site);
    process.exit(0);
  }

  console.log('Site:', site.name, site.id);
  if (site.public_id) console.log('public_id (Google Script):', site.public_id);
  console.log('dryRun:', dryRun, 'skipJunkDelete:', skipJunkDelete, 'allSources:', allSources);

  const { data: junkIds } = await supabase
    .from('calls')
    .select('id')
    .eq('site_id', site.id)
    .eq('source', 'click')
    .in('status', ['junk', 'cancelled']);

  const ids = (junkIds ?? []).map((r) => r.id as string);
  console.log('Silinecek junk/cancelled call id sayısı:', ids.length);

  if (!skipJunkDelete && !dryRun && ids.length) {
    for (const part of chunks(ids, CHUNK)) {
      const { error: delMs } = await supabase.from('marketing_signals').delete().eq('site_id', site.id).in('call_id', part);
      if (delMs) {
        console.error('marketing_signals silinemedi:', delMs.message);
        process.exit(1);
      }
    }
    for (const part of chunks(ids, CHUNK)) {
      const { error: delQ } = await supabase
        .from('offline_conversion_queue')
        .delete()
        .eq('site_id', site.id)
        .in('call_id', part);
      if (delQ) {
        console.error('offline_conversion_queue silinemedi:', delQ.message);
        process.exit(1);
      }
    }
    const { error: delC } = await supabase
      .from('calls')
      .delete()
      .eq('site_id', site.id)
      .eq('source', 'click')
      .in('status', ['junk', 'cancelled']);
    if (delC) {
      console.error('calls silinemedi:', delC.message);
      process.exit(1);
    }
    console.log('Junk/cancelled calls + ilişkili sinyal/kuyruk temizlendi.');
  } else if (dryRun && ids.length && !skipJunkDelete) {
    console.log('[DRY-RUN] calls silinmedi:', ids.slice(0, 5).join(', '), ids.length > 5 ? '...' : '');
  } else if (skipJunkDelete) {
    console.log('Junk silme atlandı (--skip-junk-delete).');
  }

  const intentCalls = await loadIntentRows(site.id, allSources);
  const sessionById = await buildSessionMap(site.id, intentCalls);

  const candidateCallIds: string[] = [];
  for (const raw of intentCalls) {
    const eff = resolveEffectiveClick(raw, sessionById);
    if (eff) candidateCallIds.push(raw.id);
  }

  const contactedName = OPSMANTIK_CONVERSION_NAMES.contacted;
  const alreadyContacted = new Set<string>();
  for (const part of chunks(candidateCallIds, CHUNK)) {
    const { data: msRows, error: msErr } = await supabase
      .from('marketing_signals')
      .select('call_id')
      .eq('site_id', site.id)
      .eq('google_conversion_name', contactedName)
      .in('call_id', part);
    if (msErr) {
      console.error('marketing_signals (contacted) sorgusu hatası:', msErr.message);
      process.exit(1);
    }
    for (const r of msRows ?? []) {
      const cid = (r as { call_id?: string | null }).call_id;
      if (cid) alreadyContacted.add(cid);
    }
  }

  const rows: IntentRow[] = [];
  for (const raw of intentCalls) {
    const c = raw;
    if (alreadyContacted.has(c.id)) continue;
    const eff = resolveEffectiveClick(c, sessionById);
    if (!eff) continue;
    rows.push({
      id: c.id,
      created_at: c.created_at,
      lead_score: c.lead_score,
      gclid: eff.gclid,
      wbraid: eff.wbraid,
      gbraid: eff.gbraid,
      clickSource: eff.clickSource,
    });
  }

  console.log(
    'Backfill adayı intent (click id session veya call + contacted yok; allSources=',
    allSources,
    '):',
    rows.length
  );

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const signalDate = new Date(row.created_at);
    if (Number.isNaN(signalDate.getTime())) {
      console.warn('Geçersiz created_at, atlanıyor', row.id);
      skipped++;
      continue;
    }

    const stage: Exclude<PipelineStage, 'won'> = 'contacted';
    const snapshot = buildOptimizationSnapshot({
      stage: 'contacted',
      systemScore: row.lead_score,
      modelVersion: 'intent-click-backfill-v2',
    });

    if (dryRun) {
      console.log('[DRY-RUN] contacted sinyali:', row.id, row.clickSource, row.created_at);
      continue;
    }

    const economics = await loadMarketingSignalEconomics({
      siteId: site.id,
      stage,
      snapshot,
    });

    const up = await upsertMarketingSignal({
      source: 'router',
      siteId: site.id,
      callId: row.id,
      traceId: null,
      stage,
      signalDate,
      snapshot,
      economics,
      clickIds: { gclid: row.gclid, wbraid: row.wbraid, gbraid: row.gbraid },
      featureSnapshotExtras: {
        source_detail: 'intent_click_backfill',
        click_attribution: row.clickSource,
      },
      causalDna: {
        branch: 'intent_click_backfill',
        call_status: 'intent',
        click_source: row.clickSource,
      },
      entropyScore: 0,
      uncertaintyBit: false,
    });

    if (up.success && up.signalId && !up.duplicate && !up.skipped) inserted++;
    else if (up.duplicate) duplicates++;
    else if (up.skipped) skipped++;
    else {
      errors++;
      console.warn('upsert başarısız', row.id);
    }
  }

  console.log('Sonuç:', { inserted, duplicates, skipped, errors });
  if (!dryRun) {
    console.log('Google Ads Script / birleşik export: PENDING marketing_signals çekilebilir.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
