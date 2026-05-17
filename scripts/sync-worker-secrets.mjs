import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });

async function sync() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const privateClient = createClient(supabaseUrl, serviceRoleKey, { schema: 'private' });

  console.log('Fetching sites and secrets...');
  
  // 1. Get all sites with their domains
  const { data: sites, error: sitesErr } = await supabase
    .from('sites')
    .select('id, public_id, name');
    
  if (sitesErr) throw sitesErr;

  const secretsMap = {};
  const siteConfig = {};

  for (const site of sites) {
    // 2. Get secret for each site
    const { data: secrets, error: secretErr } = await privateClient.rpc('get_site_secrets', { p_site_id: site.id });
    if (!secretErr && secrets) {
        const row = Array.isArray(secrets) ? secrets[0] : secrets;
        if (row?.current_secret) {
            secretsMap[site.public_id] = row.current_secret;
        }
    }

    // 3. Get domains for each site (simplified: we'll use site name or common domains if we can't find a table)
    // Actually, we can check the 'site_domains' table if it exists.
  }

  // Fallback/Hardcoded for known ones from wrangler.jsonc
  const known = {
    "kocotokurtarma.com": "93cb9966bcf349c1b4ece8ea34142ace",
    "muratcanaku.com": "178c4e31306e436b8be67d5f6134b118",
    "umutotocekici.com": "b54e2f0e3ca44fd1a614d8d99bfa6902",
    "spotbizdelastik.com": "00699ff719394611b224a05ffab0675d",
    "gecgenotokurtarici.com": "862314ce888d44b29aa222833e9b0af2"
  };

  Object.assign(siteConfig, known);

  console.log('Secrets Map:', secretsMap);
  console.log('Site Config:', siteConfig);

  fs.writeFileSync('adsmantik-engine/secrets-sync.json', JSON.stringify(secretsMap, null, 2));
}

sync().catch(console.error);
