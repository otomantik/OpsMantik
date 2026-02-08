#!/usr/bin/env node
/**
 * Get tracker embed code (with secret) for a site. Use with SUPABASE_SERVICE_ROLE_KEY.
 * Run: node scripts/get-tracker-embed.mjs <site_public_id>
 * Or:  SITE_PUBLIC_ID=xxx node scripts/get-tracker-embed.mjs
 *
 * Output: script tag with data-ops-site-id and data-ops-secret so call-event returns 200 (signed).
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicId = process.argv[2] || process.env.SITE_PUBLIC_ID;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (e.g. in .env.local)');
  process.exit(1);
}

if (!publicId || publicId.length < 10) {
  console.error('Usage: node scripts/get-tracker-embed.mjs <site_public_id>');
  console.error('Example: node scripts/get-tracker-embed.mjs b298a0393f0541c6bd7e4643269abcc6');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function main() {
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, name, public_id')
    .eq('public_id', publicId)
    .maybeSingle();

  if (siteErr || !site) {
    console.error('Site not found for public_id:', publicId, siteErr?.message || '');
    process.exit(1);
  }

  const privateClient = createClient(supabaseUrl, serviceRoleKey, { schema: 'private' });
  const { data: secrets, error: secretErr } = await privateClient.rpc('get_site_secrets', {
    p_site_id: site.id,
  });

  if (secretErr) {
    console.error('Could not read secret (RPC error):', secretErr.message);
    process.exit(1);
  }

  const row = Array.isArray(secrets) ? secrets[0] : secrets;
  const secret = row?.current_secret;
  if (!secret) {
    console.error('No secret found for this site. Provision one first (e.g. via set_site_secrets_v1 or dashboard).');
    process.exit(1);
  }

  const consoleUrl = 'https://console.opsmantik.com';
  const scriptTag = `<script src="${consoleUrl}/assets/core.js" data-ops-site-id="${site.public_id}" data-ops-secret="${secret}" data-api="${consoleUrl}/api/sync"></script>`;

  console.log('Site:', site.name || site.public_id);
  console.log('Public ID:', site.public_id);
  console.log('');
  console.log('--- Tracker embed (copy to site; secret is inside - keep private) ---');
  console.log(scriptTag);
  console.log('---');
  console.log('');
  console.log('After adding this script, WhatsApp/phone clicks will send signed requests and /api/call-event will return 200.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
