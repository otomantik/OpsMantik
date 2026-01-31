#!/usr/bin/env node
/**
 * Smoke: AI score pipeline gate — verify configuration (no pipeline changes).
 * Checks: OPENAI_API_KEY in env (not printed), hunter-ai reachable, pg_net, trigger, api_keys.
 * No secrets printed.
 * Usage: node scripts/smoke/ai-pipeline-gate.mjs
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENAI_API_KEY_SET = Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim());

function log(msg, color) {
  const c = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log((c[color] || '') + msg + c.reset);
}

async function main() {
  log('\n=== AI Pipeline Gate ===\n', 'cyan');

  let fail = false;

  // 1) OPENAI_API_KEY exists (do not print)
  if (OPENAI_API_KEY_SET) {
    log('1) OPENAI_API_KEY: set (not printed)', 'cyan');
  } else {
    log('1) OPENAI_API_KEY: not in process env (configure in Dashboard → Edge Functions → hunter-ai → Secrets)', 'yellow');
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log('FAIL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', 'red');
    process.exit(1);
  }

  // 2) hunter-ai reachable (do not print key)
  const hunterAiUrl = SUPABASE_URL + '/functions/v1/hunter-ai';
  let reachable = false;
  try {
    const res = await fetch(hunterAiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({}),
    });
    if (res.status === 404) {
      log('2) hunter-ai: not deployed (404)', 'red');
      fail = true;
    } else {
      reachable = true;
      log('2) hunter-ai: reachable (status ' + res.status + ')', 'cyan');
    }
  } catch (e) {
    log('2) hunter-ai: request failed — ' + (e.message || e), 'red');
    fail = true;
  }

  // 3) pg_net + trigger + api_keys via RPC
  let pgNetOk = false;
  let triggerOk = false;
  let apiKeysOk = false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc('ai_pipeline_gate_checks');
    if (error) {
      log('3) ai_pipeline_gate_checks: ' + error.message + ' (apply migration 20260130251300?)', 'red');
      fail = true;
    } else if (data) {
      pgNetOk = data.pg_net_enabled === true;
      triggerOk = data.trigger_exists === true;
      apiKeysOk = data.api_keys_configured === true;
      log('3) pg_net: ' + (pgNetOk ? 'enabled' : 'disabled') + ', trigger: ' + (triggerOk ? 'exists' : 'missing') + ', api_keys: ' + (apiKeysOk ? 'configured' : 'missing'), pgNetOk && triggerOk && apiKeysOk ? 'cyan' : 'red');
      if (!pgNetOk || !triggerOk || !apiKeysOk) fail = true;
    }
  } catch (e) {
    log('3) RPC failed: ' + (e.message || e), 'red');
    fail = true;
  }

  log('\n---', 'reset');
  if (fail) {
    log('FAIL (fix config: pg_net, trigger, api_keys, or hunter-ai deploy). See docs/WAR_ROOM/REPORTS/AI_SCORE_PIPELINE_GATE.md', 'red');
    process.exit(1);
  }
  log('PASS (AI pipeline gate: hunter-ai reachable, pg_net enabled, trigger exists, api_keys configured)', 'green');
  log('', 'reset');
}

main().catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
