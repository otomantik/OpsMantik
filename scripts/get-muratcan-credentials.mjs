#!/usr/bin/env node
/**
 * Fetch Muratcan Akü site public_id and oci_api_key from Supabase.
 * One-off script for GoogleAdsScript.js configuration.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from('sites')
  .select('id, public_id, oci_api_key, name, domain')
  .or('name.ilike.%Muratcan%,name.ilike.%muratcan%,domain.ilike.%muratcan%');

if (error) {
  console.error('Supabase error:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.error('Muratcan site not found');
  process.exit(1);
}

const site = data[0];
console.log(JSON.stringify(site, null, 2));
