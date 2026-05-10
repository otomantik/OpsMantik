#!/usr/bin/env node
/**
 * PR-9H.7G — Fresh persisted hashed-phone canary candidate (Koç Oto Kurtarma).
 *
 * Read-only. Never prints gclid, wbraid, gbraid, hash hex, or raw phone.
 *
 * Filters:
 * - QUEUED / RETRY, google_ads, OpsMantik_Won only, value_cents > 0, gclid present,
 *   valid 64-char hex hashed phone (queue user_identifiers OR calls.caller_phone_hash_sha256),
 *   currency matches site.
 * - Excludes legacy completed canary queue id by default (do not reuse).
 *
 * Usage:
 *   TARGET_SITE_ID=93cb9966bcf349c1b4ece8ea34142ace LIMIT=5 node scripts/db/pr9h7g-fresh-hashed-phone-canary.mjs
 *
 * Env:
 *   TARGET_SITE_ID | OPSMANTIK_SITE_ID (required)
 *   EXCLUDE_QUEUE_IDS — comma UUIDs (default includes PR-9H.7E legacy row)
 *   LIMIT — default 5
 *   OUTPUT_JSON — 1 for JSON
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const VALID_HASH_HEX = /^[a-f0-9]{64}$/;
const DEFAULT_EXCLUDE = new Set(['a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2']);

function parseExcludeEnv() {
  const raw = String(process.env.EXCLUDE_QUEUE_IDS ?? '').trim();
  const s = new Set(DEFAULT_EXCLUDE);
  if (raw) {
    for (const p of raw.split(',')) {
      const id = p.trim().toLowerCase();
      if (id) s.add(id);
    }
  }
  return s;
}

function parseUserIdentifiers(raw) {
  if (raw == null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return typeof j === 'object' && j !== null ? j : null;
    } catch {
      return null;
    }
  }
  return null;
}

function resolveQueueHash(uid) {
  if (!uid || typeof uid !== 'object') return null;
  const a = typeof uid.hashed_phone === 'string' ? uid.hashed_phone.trim().toLowerCase() : '';
  if (VALID_HASH_HEX.test(a)) return 'queue_user_identifiers';
  const b = typeof uid.hashedPhoneNumber === 'string' ? uid.hashedPhoneNumber.trim().toLowerCase() : '';
  if (VALID_HASH_HEX.test(b)) return 'queue_user_identifiers';
  return null;
}

function hasConversionTime(row) {
  const t = row.conversion_time ?? row.occurred_at;
  return typeof t === 'string' && t.trim().length > 0;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
const providerKey = 'google_ads';
const limitOut = Math.max(1, Math.min(50, Number(process.env.LIMIT || 5) || 5));
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';
const excludeIds = parseExcludeEnv();
const fetchCap = Math.min(2000, Math.max(limitOut * 30, 200));

const ACTION_WON = 'OpsMantik_Won';

if (!url || !key) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'ENV_MISSING' }) : 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const adminClient = createClient(url, key);

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'RESOLVE_ERROR', detail: msg }) : msg);
  process.exit(1);
}

if (!resolved.found) {
  console.error(
    outputJson
      ? JSON.stringify({ ok: false, code: 'SITE_NOT_FOUND', hint: SITE_NOT_FOUND_HINT })
      : SITE_NOT_FOUND_HINT
  );
  process.exit(1);
}

const siteUuid = resolved.siteUuid;
const publicId = resolved.publicId ?? null;

const { data: siteRow, error: siteErr } = await adminClient
  .from('sites')
  .select('currency')
  .eq('id', siteUuid)
  .maybeSingle();

if (siteErr) {
  console.error(siteErr.message);
  process.exit(1);
}

const siteCurrency = String(siteRow?.currency ?? '').trim().toUpperCase();

async function fetchQueueRows(selectList) {
  return adminClient
    .from('offline_conversion_queue')
    .select(selectList)
    .eq('site_id', siteUuid)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', providerKey)
    .eq('action', ACTION_WON)
    .order('updated_at', { ascending: true })
    .limit(fetchCap);
}

let queueSelect =
  'id, action, status, currency, value_cents, conversion_time, occurred_at, gclid, wbraid, gbraid, user_identifiers, call_id';
let { data: qrows, error: qerr } = await fetchQueueRows(queueSelect);

if (qerr && /column|does not exist|schema cache|PGRST204|42703/i.test(String(qerr.message || ''))) {
  queueSelect = 'id, action, status, currency, value_cents, conversion_time, occurred_at, gclid, user_identifiers, call_id';
  ({ data: qrows, error: qerr } = await fetchQueueRows(queueSelect));
}

if (qerr) {
  console.error(qerr.message);
  process.exit(1);
}

const rows = Array.isArray(qrows) ? qrows : [];
const callIds = [...new Set(rows.map((r) => r.call_id).filter(Boolean))];

const hashByCall = {};
if (callIds.length > 0) {
  const { data: crows, error: cerr } = await adminClient
    .from('calls')
    .select('id, caller_phone_hash_sha256')
    .eq('site_id', siteUuid)
    .in('id', callIds);

  if (!cerr && crows) {
    for (const c of crows) {
      const id = c.id != null ? String(c.id) : '';
      const h =
        typeof c.caller_phone_hash_sha256 === 'string' ? c.caller_phone_hash_sha256.trim().toLowerCase() : '';
      if (id && VALID_HASH_HEX.test(h)) hashByCall[id] = 'call_caller_phone_hash_sha256';
    }
  }
}

function classify(row) {
  const qid = String(row.id ?? '').toLowerCase();
  if (excludeIds.has(qid)) return null;

  const cur = String(row.currency ?? '').trim().toUpperCase();
  if (siteCurrency && cur !== siteCurrency) return null;
  if (String(row.action ?? '').trim() !== ACTION_WON) return null;
  if (!hasConversionTime(row)) return null;
  const g = typeof row.gclid === 'string' ? row.gclid.trim() : '';
  if (!g) return null;
  const vc = row.value_cents;
  const n = typeof vc === 'number' ? vc : Number(vc);
  if (!Number.isFinite(n) || n <= 0) return null;

  const uid = parseUserIdentifiers(row.user_identifiers);
  const qs = resolveQueueHash(uid);
  const cid = row.call_id != null ? String(row.call_id) : '';
  const callSrc = cid ? hashByCall[cid] : null;

  let hashSource = null;
  if (qs) hashSource = qs;
  else if (callSrc) hashSource = callSrc;
  if (!hashSource) return null;

  const wb = typeof row.wbraid === 'string' ? row.wbraid.trim() : '';
  const gb = typeof row.gbraid === 'string' ? row.gbraid.trim() : '';

  return {
    queue_id: String(row.id),
    site_id: siteUuid,
    public_id: publicId,
    status: String(row.status ?? ''),
    action: ACTION_WON,
    value_cents: n,
    has_gclid: true,
    has_wbraid: wb.length > 0,
    has_gbraid: gb.length > 0,
    has_hashed_phone: true,
    hash_source: hashSource,
  };
}

const candidates = [];
for (const row of rows) {
  const c = classify(row);
  if (c) candidates.push(c);
  if (candidates.length >= limitOut) break;
}

const summary = {
  ok: true,
  code: 'PR9H7G_FRESH_CANARY_CANDIDATES',
  policy: 'PR-9H.7G',
  site_id: siteUuid,
  public_id: publicId,
  provider_key: providerKey,
  action_filter: ACTION_WON,
  excluded_queue_ids: [...excludeIds],
  scanned_queue_rows: rows.length,
  candidates_returned: candidates.length,
  read_only: true,
  candidates,
};

if (outputJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('PR-9H.7G fresh hashed-phone canary candidates (read-only)');
  console.log(`site_id=${siteUuid} public_id=${publicId ?? '(null)'}`);
  console.log(`scanned=${rows.length} matched=${candidates.length} excluded_defaults=${DEFAULT_EXCLUDE.size}`);
  for (const r of candidates) {
    console.log(
      `- queue_id=${r.queue_id} status=${r.status} value_cents=${r.value_cents} has_wbraid=${r.has_wbraid} has_gbraid=${r.has_gbraid} has_hashed_phone=${r.has_hashed_phone} hash_source=${r.hash_source}`
    );
  }
}
