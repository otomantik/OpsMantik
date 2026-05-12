#!/usr/bin/env node
/**
 * PR-9K — Read-only selector: COMPLETED offline_conversion_queue rows whose last script completion
 * in the incident window looks like an unconfirmed Google Ads Script bulk-upload finalize (ledger-first).
 *
 * Never prints gclid / wbraid / gbraid / hashed phone values — only queue_id and aggregate labels.
 *
 * Usage:
 *   PR9K_SITE_ID=<sites.id uuid> PR9K_SITE_PUBLIC_ID=<sites.public_id> \\
 *   PR9K_WINDOW_START=<ISO> PR9K_WINDOW_END=<ISO> \\
 *   OUTPUT_JSON=1 node scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs
 *
 * Or with export run (optional window narrows the derived window):
 *   PR9K_EXPORT_RUN_ID=<run> ...
 *
 * Optional: PR9K_INCLUDE_ACTIONS=action1,action2  PR9K_INCIDENT_KEY=<key> (excludes audit hits for that key)
 *
 * OUTPUT_JSON=1 example (read-only RPC; no writes from this script):
 *   PR9K_SITE_ID=<uuid> PR9K_SITE_PUBLIC_ID=<public_id> PR9K_INCIDENT_KEY=demo-incident \\
 *   PR9K_WINDOW_START=2026-05-01T00:00:00.000Z PR9K_WINDOW_END=2026-05-02T00:00:00.000Z OUTPUT_JSON=1 \\
 *   node scripts/db/pr9k-select-unconfirmed-script-completed-rows.mjs
 *
 * Evidence policy (PR-E): RPC excludes rows with API-strength provider_request_id (UUID / customers/...).
 * Non-empty provider_ref alone is not treated as provider-confirmed import proof.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteId = String(process.env.PR9K_SITE_ID || '').trim();
const sitePublicId = String(process.env.PR9K_SITE_PUBLIC_ID || '').trim();
const windowStart = String(process.env.PR9K_WINDOW_START || '').trim();
const windowEnd = String(process.env.PR9K_WINDOW_END || '').trim();
const exportRunId = String(process.env.PR9K_EXPORT_RUN_ID || '').trim();
const incidentKey = String(process.env.PR9K_INCIDENT_KEY || '').trim();
const includeActionsRaw = String(process.env.PR9K_INCLUDE_ACTIONS || '').trim();
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';

function fail(code, detail) {
  const err = {
    ok: false,
    decision_label: 'PR9K_SELECTOR_CONFIG_MISSING',
    code,
    detail,
  };
  console.error(outputJson ? JSON.stringify(err, null, 2) : `${code}: ${detail}`);
  process.exit(1);
}

if (!url || !key) {
  fail('ENV_MISSING', 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (!siteId || !sitePublicId) {
  fail('PR9K_SITE', 'PR9K_SITE_ID and PR9K_SITE_PUBLIC_ID required');
}

const hasWindow = windowStart.length > 0 && windowEnd.length > 0;
const hasRun = exportRunId.length > 0;
if (!hasRun && !hasWindow) {
  fail('PR9K_WINDOW', 'Set PR9K_EXPORT_RUN_ID or both PR9K_WINDOW_START and PR9K_WINDOW_END');
}

const includeActions =
  includeActionsRaw.length > 0
    ? includeActionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

const adminClient = createClient(url, key);

const ws = hasWindow ? new Date(windowStart).toISOString() : null;
const we = hasWindow ? new Date(windowEnd).toISOString() : null;
if (hasWindow && (Number.isNaN(Date.parse(ws)) || Number.isNaN(Date.parse(we)))) {
  fail('PR9K_WINDOW_PARSE', 'PR9K_WINDOW_START / PR9K_WINDOW_END must be valid ISO timestamps');
}

const { data, error } = await adminClient.rpc('pr9k_unconfirmed_script_completed_candidates_v1', {
  p_site_id: siteId,
  p_site_public_id: sitePublicId,
  p_window_start: hasWindow ? ws : null,
  p_window_end: hasWindow ? we : null,
  p_export_run_id: hasRun ? exportRunId : null,
  p_incident_key: incidentKey.length > 0 ? incidentKey : null,
  p_include_actions: includeActions,
});

if (error) {
  fail('RPC_ERROR', error.message || String(error));
}

const out = {
  ...data,
  final_labels: {
    PR9K_SELECTOR_READY: data?.ok === true && data?.selector_decision_label === 'PR9K_SELECTOR_READY',
    PR9K_GOOGLE_SCRIPT_PROVIDER_CONFIRMATION_PENDING_GREEN:
      data?.ok === true && typeof data?.decision_label === 'string',
  },
};

if (outputJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('decision_label:', out.decision_label);
  console.log('selector_decision_label:', out.selector_decision_label);
  console.log('eligible:', out.counts?.eligible);
  const ids = (out.candidates || []).map((c) => c.queue_id).join(',');
  console.log('queue_ids:', ids);
}
