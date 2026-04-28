#!/usr/bin/env node
/**
 * Muratcan AKU bootstrap for SST + Cloudflare adsmantik-engine.
 *
 * What this script does:
 * 1) Builds tracker bundle (public/assets/core.js)
 * 2) Resolves site UUID from public_id
 * 3) Reads call-event signing secret from private.get_site_secrets
 * 4) Generates deployment artifacts for Cloudflare/SST wiring
 * 5) Copies core.js into an artifact folder for external integration
 *
 * Usage:
 *   node scripts/deploy-muratcan-aku-sst.mjs --site-public-id <SITE_PUBLIC_ID> --domain <DOMAIN> --worker-url <https://worker.example.workers.dev>
 *
 * Optional:
 *   --out-dir artifacts/muratcan-aku
 *   --skip-build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function argValue(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] || fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[muratcan-sst] Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function run(cmd, args, cwd = repoRoot) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`[muratcan-sst] Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status || 1);
  }
}

async function main() {
  const sitePublicId = argValue('--site-public-id');
  const domain = argValue('--domain').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  const workerUrl = argValue('--worker-url').trim().replace(/\/+$/, '');
  const callEventSecretArg = argValue('--call-event-secret').trim();
  const outDirInput = argValue('--out-dir', 'artifacts/muratcan-aku');
  const outDir = path.resolve(repoRoot, outDirInput);

  if (!sitePublicId) {
    console.error('Usage error: --site-public-id is required');
    process.exit(1);
  }
  if (!domain) {
    console.error('Usage error: --domain is required');
    process.exit(1);
  }
  if (!workerUrl) {
    console.error('Usage error: --worker-url is required (Cloudflare worker base URL)');
    process.exit(1);
  }

  if (!hasFlag('--skip-build')) {
    console.log('[muratcan-sst] Building tracker bundle...');
    run('npm', ['run', 'tracker:build'], repoRoot);
  }

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log('[muratcan-sst] Resolving site...');
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, public_id, name')
    .eq('public_id', sitePublicId)
    .maybeSingle();
  if (siteErr || !site?.id) {
    console.error('[muratcan-sst] Site not found:', siteErr?.message || sitePublicId);
    process.exit(1);
  }

  let currentSecret = callEventSecretArg;
  if (!currentSecret) {
    console.log('[muratcan-sst] Reading call-event secret...');
    const privateClient = createClient(supabaseUrl, serviceRoleKey, { schema: 'private' });
    const { data: secrets, error: secretErr } = await privateClient.rpc('get_site_secrets', { p_site_id: site.id });
    if (secretErr) {
      console.error('[muratcan-sst] get_site_secrets failed:', secretErr.message);
      console.error('[muratcan-sst] Fallback: rerun with --call-event-secret <SECRET>');
      process.exit(1);
    }
    const row = Array.isArray(secrets) ? secrets[0] : secrets;
    currentSecret = row?.current_secret || '';
  }
  if (!currentSecret) {
    console.error('[muratcan-sst] No call-event secret resolved. Use --call-event-secret.');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const trackerPath = path.join(repoRoot, 'public', 'assets', 'core.js');
  const trackerOutPath = path.join(outDir, 'core.js');
  fs.copyFileSync(trackerPath, trackerOutPath);

  const siteConfigMap = { [domain]: site.public_id };
  const secretMap = { [site.public_id]: currentSecret };

  const embedSnippet = [
    `<script src="https://console.opsmantik.com/assets/core.js?v=7"`,
    `  data-ops-site-id="${site.public_id}"`,
    `  data-api="${workerUrl}/opsmantik/sync"`,
    `  data-ops-proxy-url="${workerUrl}/opsmantik/call-event"></script>`,
  ].join('\n');

  const wranglerVars = {
    OPSMANTIK_BASE_URL: 'https://console.opsmantik.com',
    SITE_CONFIG: JSON.stringify(siteConfigMap),
    SITE_CONFIG_URL: 'https://console.opsmantik.com/api/internal/worker/tenant-map',
    SITE_CONFIG_TTL_MS: '300000',
  };

  fs.writeFileSync(path.join(outDir, 'site-config.json'), `${JSON.stringify(siteConfigMap, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'ops-call-event-secrets.json'), `${JSON.stringify(secretMap, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'wrangler-vars.json'), `${JSON.stringify(wranglerVars, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'embed-snippet.html'), `${embedSnippet}\n`, 'utf8');

  const runbook = `# Muratcan AKU SST/Cloudflare Bootstrap

Site: ${site.name || '(unnamed)'} (${site.public_id})
Domain: ${domain}
Worker URL: ${workerUrl}

## 1) Cloudflare Worker vars/secrets

- wrangler vars: use \`wrangler-vars.json\`
- secret payload file: \`ops-call-event-secrets.json\`

Set secret:
\`\`\`bash
wrangler secret put OPS_CALL_EVENT_SECRETS < "${path.join(outDirInput, 'ops-call-event-secrets.json')}"
\`\`\`

Optional tenant map token:
\`\`\`bash
wrangler secret put WORKER_TENANT_MAP_TOKEN
\`\`\`

## 2) Deploy adsmantik-engine
\`\`\`bash
npm --prefix adsmantik-engine run deploy
\`\`\`

## 3) External integration artifacts

- Tracker file to share: \`${path.join(outDirInput, 'core.js')}\`
- Embed snippet: \`${path.join(outDirInput, 'embed-snippet.html')}\`
`;
  fs.writeFileSync(path.join(outDir, 'README.md'), runbook, 'utf8');

  console.log('[muratcan-sst] Done.');
  console.log(`[muratcan-sst] Artifacts: ${outDir}`);
  console.log(`[muratcan-sst] core.js ready: ${trackerOutPath}`);
}

main().catch((err) => {
  console.error('[muratcan-sst] Fatal error:', err);
  process.exit(1);
});
