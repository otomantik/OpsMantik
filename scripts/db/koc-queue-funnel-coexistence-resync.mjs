#!/usr/bin/env node
/**
 * Koç Oto Kurtarma — funnel coexistence ile uyumlu kuyruk:
 * - Varsayılan site: `93cb9966bcf349c1b4ece8ea34142ace` (TARGET_SITE_ID / OPSMANTIK_SITE_ID yoksa).
 * - APPLY dışı: aktif google_ads kuyruk satırlarının özeti + export’ta “üçlü” (Görüşüldü+Teklif+Kazan) Won-only
 *   sıkıştırması yiyecek grup sayısı (read-only).
 * - APPLY=1: PR-9H.6.1 canonical enqueue (`pr9h6-backfill-intents-to-oci-queue.mjs`) — mevcut çağrı
 *   statüsüne uygun eksik journal satırlarını doldurur (Won çağrıya Contacted geçmişi eklemez; statü
 *   contacted/offered/junk/won ile eşleşen aşamalar).
 *
 * Dry-run / özet (önerilen):
 *   node scripts/db/koc-queue-funnel-coexistence-resync.mjs
 *
 * Apply (Koç, tam aşama allowlist, üst sınır):
 *   APPLY=1 \
 *   I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL=I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL \
 *   MAX_ROWS=2000 \
 *   node scripts/db/koc-queue-funnel-coexistence-resync.mjs
 *
 * Başka site:
 *   TARGET_SITE_ID=<public_id|uuid> node scripts/db/koc-queue-funnel-coexistence-resync.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
config({ path: join(repoRoot, '.env.local'), override: true });

const KOC_DEFAULT_PUBLIC_ID = '93cb9966bcf349c1b4ece8ea34142ace';
const DEFAULT_STAGE_ALLOWLIST = 'contacted,offered,won,junk_exclusion';

const ACTION_TO_GEAR = {
  OpsMantik_Contacted: 'contacted',
  OpsMantik_Offered: 'offered',
  OpsMantik_Won: 'won',
  OpsMantik_Junk_Exclusion: 'junk',
};

function buildGroupKey(sessionId, callId, rowId) {
  const s = sessionId != null ? String(sessionId).trim() : '';
  if (s) return `session:${s}`;
  const c = callId != null ? String(callId).trim() : '';
  if (c) return `call:${c}`;
  return `fallback:${String(rowId ?? 'unknown')}`;
}

function gearFromAction(action) {
  const a = String(action ?? '').trim();
  return ACTION_TO_GEAR[a] ?? null;
}

async function runGapSummary(admin, siteUuid) {
  const { data: rows, error } = await admin
    .from('offline_conversion_queue')
    .select('id, call_id, session_id, action, status')
    .eq('site_id', siteUuid)
    .eq('provider_key', 'google_ads')
    .in('status', ['QUEUED', 'RETRY', 'PROCESSING'])
    .order('updated_at', { ascending: true })
    .limit(8000);

  if (error) throw new Error(error.message);

  const byAction = {};
  let noCall = 0;
  const groupToGears = new Map();

  for (const r of rows || []) {
    const act = (r.action ?? '').trim();
    byAction[act] = (byAction[act] ?? 0) + 1;
    if (!r.call_id) {
      noCall += 1;
      continue;
    }
    const gk = buildGroupKey(r.session_id, r.call_id, r.id);
    const g = gearFromAction(act);
    if (!g) continue;
    if (!groupToGears.has(gk)) groupToGears.set(gk, new Set());
    groupToGears.get(gk).add(g);
  }

  let fullTripleGroups = 0;
  for (const gears of groupToGears.values()) {
    if (gears.has('contacted') && gears.has('offered') && gears.has('won')) fullTripleGroups += 1;
  }

  return {
    active_row_total: (rows || []).length,
    rows_missing_call_id: noCall,
    action_counts: byAction,
    attribution_groups_with_gear: groupToGears.size,
    /** Export `selectCoexistentFunnelExportCandidates`: bu grupta yalnızca Won kalır, diğerleri bastırılır. */
    groups_full_funnel_contacted_offered_won: fullTripleGroups,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({ ok: false, code: 'ENV_MISSING' }, null, 2));
    process.exit(1);
  }

  if (!String(process.env.TARGET_SITE_ID || '').trim() && !String(process.env.OPSMANTIK_SITE_ID || '').trim()) {
    process.env.TARGET_SITE_ID = KOC_DEFAULT_PUBLIC_ID;
  }

  const apply =
    process.env.APPLY === '1' &&
    process.env.I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL === 'I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL';

  if (apply && !String(process.env.STAGE_ALLOWLIST || '').trim()) {
    process.env.STAGE_ALLOWLIST = DEFAULT_STAGE_ALLOWLIST;
  }

  const admin = createClient(url, key);
  const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
  let resolved;
  try {
    resolved = await resolveSiteIdentity(admin, rawTarget);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, detail: String(e) }, null, 2));
    process.exit(1);
  }
  if (!resolved.found) {
    console.error(JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT }, null, 2));
    process.exit(1);
  }

  if (apply) {
    const child = join(__dirname, 'pr9h6-backfill-intents-to-oci-queue.mjs');
    const r = spawnSync(process.execPath, [child], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'inherit',
    });
    process.exit(typeof r.status === 'number' ? r.status : 1);
  }

  const gap = await runGapSummary(admin, resolved.siteUuid);
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'FUNNEL_COEXISTENCE_QUEUE_SUMMARY',
        export_policy:
          'Aynı call/session: varsayılan hepsi export; yalnızca Görüşüldü+Teklif+Kazan üçünü birden taşıyan grupta yalnız Won.',
        site: { sites_id: resolved.siteUuid, public_id: resolved.publicId ?? null, input: resolved.input },
        gap,
        apply_hint: {
          cmd: 'APPLY=1 I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL=I_APPROVE_INTENT_TO_OCI_QUEUE_BACKFILL MAX_ROWS=2000 node scripts/db/koc-queue-funnel-coexistence-resync.mjs',
          note: 'Apply yalnızca çağrının güncel statüsüne uyan aşamaları enqueue eder; geçmiş contacted satırı için ayrı veri onarımı gerekir.',
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, code: 'FATAL', detail: String(e) }, null, 2));
  process.exit(1);
});
