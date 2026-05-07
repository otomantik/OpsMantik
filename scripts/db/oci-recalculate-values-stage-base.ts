#!/usr/bin/env tsx
import { config } from 'dotenv';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const POLICY_VERSION = 'oci_conversion_value_policy_v1';
const TARGET_CENTS: Record<string, number> = {
  OpsMantik_Contacted: 1000,
  OpsMantik_Offered: 5000,
  OpsMantik_Won: 10000,
  OpsMantik_Junk_Exclusion: 10,
};

function normalize(value: string | null | undefined, fallback = ''): string {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return trimmed || fallback;
}

function computeExternalId(params: {
  providerKey?: string | null;
  action?: string | null;
  saleId?: string | null;
  callId?: string | null;
  sessionId?: string | null;
}): string {
  const fingerprint = `${normalize(params.providerKey, 'google_ads')}|${normalize(params.action, 'purchase')}|${normalize(params.saleId)}|${normalize(params.callId)}|${normalize(params.sessionId)}`;
  return `oci_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

function queueSource(action: string, actualRevenue: number | null): string {
  if (action === 'OpsMantik_Junk_Exclusion') return 'fixed_junk_exclusion';
  if (action === 'OpsMantik_Won') return Number(actualRevenue || 0) > 0 ? 'won_stage_model_with_actual_revenue' : 'won_stage_model_fallback';
  return 'stage_model';
}

function queueReason(action: string, actualRevenue: number | null): string {
  if (action === 'OpsMantik_Junk_Exclusion') return 'junk_exclusion_nominal_fixed_10c';
  if (action === 'OpsMantik_Won') return Number(actualRevenue || 0) > 0 ? 'won_stage_model_actual_revenue_present' : 'won_stage_model_actual_revenue_missing';
  if (action === 'OpsMantik_Offered') return 'stage_model_offered';
  if (action === 'OpsMantik_Contacted') return 'stage_model_contacted';
  return 'stage_model';
}

function signalSource(name: string): string {
  return name === 'OpsMantik_Junk_Exclusion' ? 'fixed_junk_exclusion' : 'stage_model';
}

function signalReason(name: string): string {
  if (name === 'OpsMantik_Junk_Exclusion') return 'junk_exclusion_nominal_fixed_10c';
  if (name === 'OpsMantik_Contacted') return 'stage_model_contacted';
  if (name === 'OpsMantik_Offered') return 'stage_model_offered';
  return 'stage_model';
}

async function resolveSiteId(raw: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw;
  const { data, error } = await supabase
    .from('sites')
    .select('id,name')
    .or(`name.ilike.%${raw}%,domain.ilike.%${raw}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) throw new Error(`Site not found: ${raw}`);
  return data.id;
}

async function listAllSiteIds(): Promise<string[]> {
  const { data, error } = await supabase.from('sites').select('id');
  if (error) throw error;
  return (data ?? []).map((row) => row.id).filter(Boolean);
}

async function runForSite(params: { siteId: string; dryRun: boolean; nowIso: string }) {
  const { siteId, dryRun, nowIso } = params;
  const siteResult = {
    siteId,
    queueNeedsUpdate: 0,
    signalNeedsUpdate: 0,
    queueUpdated: 0,
    signalUpdated: 0,
  };

  const { data: queueRows, error: queueErr } = await supabase
    .from('offline_conversion_queue')
    .select('id,provider_key,action,sale_id,call_id,session_id,external_id,value_cents,actual_revenue')
    .eq('site_id', siteId)
    .eq('provider_key', 'google_ads')
    .in('action', Object.keys(TARGET_CENTS));
  if (queueErr) throw queueErr;

  const queuePatches = (queueRows ?? []).flatMap((row) => {
      const target = TARGET_CENTS[row.action as keyof typeof TARGET_CENTS];
      if (!target) return [];
      const computedExternalId = computeExternalId({
        providerKey: row.provider_key,
        action: row.action,
        saleId: row.sale_id,
        callId: row.call_id,
        sessionId: row.session_id,
      });
      const fallbackUsed = row.action === 'OpsMantik_Won' ? !(Number(row.actual_revenue || 0) > 0) : false;
      const externalIdInvalid = !/^oci_[0-9a-f]{32}$/.test(String(row.external_id || ''));
      const needsUpdate =
        Number(row.value_cents) !== target || externalIdInvalid || row.external_id !== computedExternalId;
      if (!needsUpdate) return [];
      return [{
        id: row.id,
        patch: {
          value_cents: target,
          external_id: computedExternalId,
          value_policy_version: POLICY_VERSION,
          value_source: queueSource(row.action, row.actual_revenue),
          value_policy_reason: queueReason(row.action, row.actual_revenue),
          value_fallback_used: fallbackUsed,
          updated_at: nowIso,
        },
      }];
    });
  siteResult.queueNeedsUpdate = queuePatches.length;

  const { data: signalRows, error: signalErr } = await supabase
    .from('marketing_signals')
    .select('id,google_conversion_name,expected_value_cents,conversion_value')
    .eq('site_id', siteId)
    .in('google_conversion_name', Object.keys(TARGET_CENTS));
  if (signalErr) throw signalErr;

  const signalPatches = (signalRows ?? []).flatMap((row) => {
      const target = TARGET_CENTS[row.google_conversion_name as keyof typeof TARGET_CENTS];
      if (!target) return [];
      const targetMajor = target / 100;
      const needsUpdate = Number(row.expected_value_cents) !== target || Number(row.conversion_value) !== targetMajor;
      if (!needsUpdate) return [];
      return [{
        id: row.id,
        patch: {
          expected_value_cents: target,
          conversion_value: targetMajor,
          value_policy_version: POLICY_VERSION,
          value_source: signalSource(row.google_conversion_name),
          value_policy_reason: signalReason(row.google_conversion_name),
          updated_at: nowIso,
        },
      }];
    });
  siteResult.signalNeedsUpdate = signalPatches.length;

  if (dryRun) return siteResult;

  for (const row of queuePatches) {
    const { error } = await supabase.from('offline_conversion_queue').update(row.patch).eq('id', row.id);
    if (error) {
      console.error(`queue update failed ${row.id}: ${error.message}`);
      continue;
    }
    siteResult.queueUpdated += 1;
  }
  for (const row of signalPatches) {
    const { error } = await supabase.from('marketing_signals').update(row.patch).eq('id', row.id);
    if (error) {
      console.error(`signal update failed ${row.id}: ${error.message}`);
      continue;
    }
    siteResult.signalUpdated += 1;
  }

  return siteResult;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const allSites = args.includes('--all-sites');
  const siteArg = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'koc oto';
  const siteIds = allSites ? await listAllSiteIds() : [await resolveSiteId(siteArg)];
  const nowIso = new Date().toISOString();
  const results = [];
  for (const siteId of siteIds) {
    results.push(await runForSite({ siteId, dryRun, nowIso }));
  }

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    sitesProcessed: results.length,
    queueNeedsUpdateTotal: results.reduce((acc, row) => acc + row.queueNeedsUpdate, 0),
    signalNeedsUpdateTotal: results.reduce((acc, row) => acc + row.signalNeedsUpdate, 0),
    queueUpdatedTotal: results.reduce((acc, row) => acc + row.queueUpdated, 0),
    signalUpdatedTotal: results.reduce((acc, row) => acc + row.signalUpdated, 0),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
