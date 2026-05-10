#!/usr/bin/env node
/**
 * PR-9H.7C — Read-only candidates for Script v1 hashed-phone CSV canary (journal SSOT).
 *
 * Resolves public_id → sites.id; filters QUEUED/RETRY google_ads rows with TRY/site currency,
 * positive value_cents, non-empty gclid (Script v1), known action allowlist, conversion_time present,
 * and a valid 64-char lowercase SHA-256 hex from queue.user_identifiers OR calls.caller_phone_hash_sha256.
 *
 * Never prints: raw gclid, hash hex, or any phone/email PII.
 *
 * Usage:
 *   TARGET_SITE_ID=93cb9966bcf349c1b4ece8ea34142ace LIMIT=10 node scripts/db/pr9h7c-select-hashed-phone-canary-row.mjs
 *
 * Env:
 *   TARGET_SITE_ID | OPSMANTIK_SITE_ID — sites.public_id or sites.id (required)
 *   PROVIDER_KEY — default google_ads
 *   EXPECTED_CURRENCY — override; default sites.currency
 *   ACTION_ALLOWLIST — CSV of conversion names (default OpsMantik_* four-fire set)
 *   LIMIT — max rows returned (default 10)
 *   OUTPUT_JSON — 1 for JSON lines
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const VALID_HASH_HEX = /^[a-f0-9]{64}$/;

const DEFAULT_ACTIONS = [
  'OpsMantik_Won',
  'OpsMantik_Contacted',
  'OpsMantik_Offered',
  'OpsMantik_Junk_Exclusion',
];

function parseEnvList(raw, fallbackArr) {
  const s = String(raw ?? '').trim();
  if (!s) return new Set(fallbackArr);
  return new Set(
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
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

function valueOk(valueCents, action, allowZeroJunk) {
  if (valueCents == null || valueCents === undefined) return false;
  const n = typeof valueCents === 'number' ? valueCents : Number(valueCents);
  if (!Number.isFinite(n)) return false;
  if (n > 0) return true;
  if (allowZeroJunk && action === 'OpsMantik_Junk_Exclusion' && n === 0) return true;
  return false;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
const providerKey = String(process.env.PROVIDER_KEY || 'google_ads').trim() || 'google_ads';
const expectedCurrencyEnv = String(process.env.EXPECTED_CURRENCY || '').trim().toUpperCase();
const limitOut = Math.max(1, Math.min(500, Number(process.env.LIMIT || 10) || 10));
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';
const allowZeroJunk =
  process.env.ALLOW_ZERO_JUNK_VALUE === '1' || process.env.ALLOW_ZERO_JUNK_VALUE === 'true';
const fetchCap = Math.min(2000, Math.max(limitOut * 20, 200));

const actionAllow = parseEnvList(process.env.ACTION_ALLOWLIST, DEFAULT_ACTIONS);

if (!url || !key) {
  const err = { ok: false, code: 'ENV_MISSING', detail: 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  console.error(outputJson ? JSON.stringify(err, null, 2) : err.detail);
  process.exit(1);
}

const adminClient = createClient(url, key);

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'RESOLVE_ERROR', detail: msg }, null, 2) : msg);
  process.exit(1);
}

if (!resolved.found) {
  const err = {
    ok: false,
    code: 'SITE_NOT_FOUND',
    input_site_identifier: resolved.input || rawTarget,
    hint: SITE_NOT_FOUND_HINT,
  };
  console.error(outputJson ? JSON.stringify(err, null, 2) : `${err.code}\n${err.hint}`);
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

const { data: siteRow, error: siteErr } = await adminClient
  .from('sites')
  .select('currency')
  .eq('id', siteUuid)
  .maybeSingle();

if (siteErr) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'SITE_LOAD_FAILED', detail: siteErr.message }) : siteErr.message);
  process.exit(1);
}

const siteCurrency = String(siteRow?.currency ?? '').trim().toUpperCase();
const expectedCurrency = expectedCurrencyEnv || siteCurrency;

async function fetchQueueRows(selectList) {
  return adminClient
    .from('offline_conversion_queue')
    .select(selectList)
    .eq('site_id', siteUuid)
    .in('status', ['QUEUED', 'RETRY'])
    .eq('provider_key', providerKey)
    .order('updated_at', { ascending: true })
    .limit(fetchCap);
}

let queueSelect =
  'id, action, status, currency, value_cents, conversion_time, occurred_at, gclid, user_identifiers, call_id';
let { data: qrows, error: qerr } = await fetchQueueRows(queueSelect);

if (qerr && /column|does not exist|schema cache|PGRST204|42703/i.test(String(qerr.message || ''))) {
  queueSelect = 'id, action, status, currency, value_cents, conversion_time, occurred_at, gclid, call_id';
  ({ data: qrows, error: qerr } = await fetchQueueRows(queueSelect));
}

if (qerr) {
  console.error(outputJson ? JSON.stringify({ ok: false, code: 'QUEUE_QUERY_FAILED', detail: qerr.message }) : qerr.message);
  process.exit(1);
}

const rows = Array.isArray(qrows) ? qrows : [];
const callIds = [...new Set(rows.map((r) => r.call_id).filter(Boolean))];

/** @type {Record<string, string>} */
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
      if (id && VALID_HASH_HEX.test(h)) hashByCall[id] = h;
    }
  }
}

/** @param {typeof rows[number]} row */
function classify(row) {
  const cur = String(row.currency ?? '').trim().toUpperCase();
  if (expectedCurrency && cur !== expectedCurrency) return null;
  const action = String(row.action ?? '').trim();
  if (!action || !actionAllow.has(action)) return null;
  if (!hasConversionTime(row)) return null;
  const g = typeof row.gclid === 'string' ? row.gclid.trim() : '';
  if (!g) return null;
  if (!valueOk(row.value_cents, action, allowZeroJunk)) return null;

  const uid = parseUserIdentifiers(row.user_identifiers);
  const qs = resolveQueueHash(uid);
  const cid = row.call_id != null ? String(row.call_id) : '';
  const callHit = cid && hashByCall[cid];
  let hashSource = null;
  let hasHashedPhone = false;
  if (qs) {
    hashSource = qs;
    hasHashedPhone = true;
  } else if (callHit) {
    hashSource = 'call_hash';
    hasHashedPhone = true;
  }
  if (!hasHashedPhone || !hashSource) return null;

  return {
    queue_id: String(row.id),
    action,
    status: String(row.status ?? ''),
    currency: cur,
    value_cents: row.value_cents,
    conversion_time: row.conversion_time ?? row.occurred_at ?? null,
    has_gclid: true,
    has_hashed_phone: true,
    hash_source: hashSource,
    site_currency: siteCurrency || null,
    expected_currency: expectedCurrency || null,
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
  code: 'PR9H7C_CANARY_CANDIDATES',
  site_id_resolved: siteUuid,
  provider_key: providerKey,
  expected_currency: expectedCurrency || null,
  site_currency: siteCurrency || null,
  scanned_queue_rows: rows.length,
  candidates_returned: candidates.length,
  read_only: true,
  rows: candidates,
};

if (outputJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`PR-9H.7C hashed-phone canary candidates (read-only)`);
  console.log(`site=${siteUuid} provider=${providerKey} expected_currency=${expectedCurrency || '(site)'}`);
  console.log(`scanned=${rows.length} matched=${candidates.length}`);
  for (const r of candidates) {
    console.log(
      `- queue_id=${r.queue_id} action=${r.action} status=${r.status} currency=${r.currency} value_cents=${r.value_cents} has_gclid=${r.has_gclid} has_hashed_phone=${r.has_hashed_phone} hash_source=${r.hash_source}`
    );
  }
}
