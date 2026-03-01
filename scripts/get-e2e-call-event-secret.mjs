#!/usr/bin/env node
/**
 * Fetch E2E site call_event secret from Supabase and add to .env.local.
 * Run once before E2E tests (tests 4, 6, 7 need E2E_CALL_EVENT_SECRET).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_SITE_PUBLIC_ID
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

config({ path: '.env.local' });
config({ path: '.env' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
let publicId = process.env.E2E_SITE_PUBLIC_ID || process.env.E2E_SITE_ID || 'b3e9634575df45c390d99d2623ddcde5';
if (publicId.length > 32) publicId = publicId.slice(0, 32);

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key);
const privateClient = createClient(url, key, { schema: 'private' });

// Resolve site UUID from public_id
const { data: sites, error: siteErr } = await admin
  .from('sites')
  .select('id, public_id, name, domain')
  .eq('public_id', publicId)
  .limit(1);

if (siteErr) {
  console.error('Supabase error:', siteErr.message);
  process.exit(1);
}

if (!sites?.length) {
  console.error(`Site not found for public_id: ${publicId}`);
  process.exit(1);
}

const site = sites[0];
const { data: secrets } = await privateClient.rpc('get_site_secrets', { p_site_id: site.id });
const row = Array.isArray(secrets) ? secrets[0] : secrets;
let secret = row?.current_secret;

if (!secret) {
  const crypto = await import('node:crypto');
  secret = crypto.randomBytes(32).toString('hex');
  const { error: rotErr } = await admin.rpc('rotate_site_secret_v1', {
    p_site_public_id: publicId,
    p_current_secret: secret,
    p_next_secret: null,
  });
  if (rotErr) {
    console.error('rotate_site_secret_v1:', rotErr.message);
    process.exit(1);
  }
  console.log('Provisioned new call_event secret for', site.name || site.domain || publicId);
}

const envPath = join(process.cwd(), '.env.local');
let content = '';
try {
  content = readFileSync(envPath, 'utf8');
} catch {
  content = '';
}

function setEnv(lines, key, value) {
  const line = `${key}=${value}`;
  const prefix = key + '=';
  const i = lines.findIndex((l) => l.startsWith(prefix));
  if (i >= 0) lines[i] = line;
  else lines.push(line);
}

const lines = content
  .split(/\r?\n/)
  .filter((l) => !l.startsWith('E2E_SITE_ID=') && !l.startsWith('E2E_SITE_PUBLIC_ID=') && !l.startsWith('E2E_CALL_EVENT_SECRET='));
if (!content.includes('# E2E')) lines.push('', '# E2E (dashboard-watchtower tests 4,6,7 + site id for 1-3,8)');
setEnv(lines, 'E2E_SITE_ID', site.id);
setEnv(lines, 'E2E_SITE_PUBLIC_ID', site.public_id);
setEnv(lines, 'E2E_CALL_EVENT_SECRET', secret);
content = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

writeFileSync(envPath, content);
console.log('Updated .env.local with E2E_SITE_ID, E2E_SITE_PUBLIC_ID, E2E_CALL_EVENT_SECRET');
