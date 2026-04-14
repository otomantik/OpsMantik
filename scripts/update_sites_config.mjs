import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TARGET_SITES = [
  { id: '0a41d14e-f3d3-4213-a87b-b62eb8a7abda', name: 'Koç Oto Kurtarma' },
  { id: 'b50856ba-f852-4324-bd5c-7e28e98e5360', name: 'Gençgen Oto Kurtarıcı' }
];

async function updateSpecificSites() {
  console.log("--- Updating Specific Sites (Currency & Locale) ---");
  for (const site of TARGET_SITES) {
    const { data: existing, error: fetchError } = await supabase
      .from('sites')
      .select('config')
      .eq('id', site.id)
      .single();

    if (fetchError) {
      console.error(`Error fetching site ${site.name}:`, fetchError);
      continue;
    }

    const newConfig = {
      ...(existing.config || {}),
      currency: 'TRY'
    };

    const { error: updateError } = await supabase
      .from('sites')
      .update({
        currency: 'TRY',
        locale: 'tr-TR',
        config: newConfig
      })
      .eq('id', site.id);

    if (updateError) {
      console.error(`Error updating site ${site.name}:`, updateError);
    } else {
      console.log(`Successfully updated ${site.name} (${site.id})`);
    }
  }
}

async function updateGlobalSettings() {
  console.log("\n--- Updating Global Settings (Marketing Mode & Sync Method) ---");
  
  const { data: sites, error: fetchError } = await supabase
    .from('sites')
    .select('id, name, config');

  if (fetchError) {
    console.error("Error fetching all sites:", fetchError);
    return;
  }

  for (const site of sites) {
    const newConfig = {
      ...(site.config || {}),
      ingest_strict_mode: false
    };

    const { error: updateError } = await supabase
      .from('sites')
      .update({
        oci_sync_method: 'script',
        config: newConfig
      })
      .eq('id', site.id);

    if (updateError) {
      console.error(`Error updating global settings for ${site.name}:`, updateError);
    } else {
      console.log(`Global update applied to ${site.name} (${site.id})`);
    }
  }
}

async function main() {
  await updateSpecificSites();
  await updateGlobalSettings();
  console.log("\n--- Update Complete ---");
}

main().catch(console.error);
