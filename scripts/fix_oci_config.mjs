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

const STANDARD_OCI_CONFIG = {
  "channels": ["phone", "whatsapp", "form"],
  "conversion_actions": {
    "phone:V2_PULSE": "OpsMantik_V2_Ilk_Temas",
    "phone:V3_ENGAGE": "OpsMantik_V3_Nitelikli_Gorusme",
    "phone:V4_INTENT": "OpsMantik_V4_Sicak_Teklif",
    "phone:V5_SEAL": {
      "action_name": "OpsMantik_V5_DEMIR_MUHUR",
      "role": "primary",
      "adjustable": true
    },
    "whatsapp:V2_PULSE": "OpsMantik_WA_Temas",
    "whatsapp:V3_ENGAGE": "OpsMantik_WA_Nitelikli",
    "whatsapp:V5_SEAL": {
        "action_name": "OpsMantik_WA_DEMIR_MUHUR",
        "role": "primary",
        "adjustable": true
    },
    "form:V2_PULSE": "OpsMantik_V2_Ilk_Temas",
    "form:V3_ENGAGE": "OpsMantik_V3_Nitelikli_Gorusme",
    "form:V4_INTENT": "OpsMantik_V4_Sicak_Teklif",
    "form:V5_SEAL": {
      "action_name": "OpsMantik_V5_DEMIR_MUHUR",
      "role": "primary",
      "adjustable": true
    }
  },
  "currency": "TRY",
  "value_mode": "aov_formula",
  "default_aov": 3000,
  "timezone": "Europe/Istanbul",
  "max_click_age_days": 90,
  "enhanced_conversions": {
    "enabled": false,
    "fallback_identifiers": ["hashed_phone"],
    "use_oct_fallback": false
  }
};

async function fixOciConfigs() {
  console.log("--- Initializing OCI Configs ---");
  for (const site of TARGET_SITES) {
    const { error: updateError } = await supabase
      .from('sites')
      .update({
        oci_config: STANDARD_OCI_CONFIG
      })
      .eq('id', site.id);

    if (updateError) {
      console.error(`Error updating site ${site.name}:`, updateError);
    } else {
      console.log(`Successfully initialized OCI config for ${site.name} (${site.id})`);
    }
  }
}

async function resetFailedConversions() {
  console.log("\n--- Resetting Failed EXPORT_GATE_REJECTED rows ---");
  
  // 1. Find the failed rows
  const siteIds = TARGET_SITES.map(s => s.id);
  const { data: failedRows, error: fetchError } = await supabase
    .from('offline_conversion_queue')
    .select('id')
    .eq('status', 'FAILED')
    .eq('last_error', 'EXPORT_GATE_REJECTED')
    .in('site_id', siteIds);

  if (fetchError) {
    console.error("Error fetching failed rows:", fetchError);
    return;
  }

  if (!failedRows || failedRows.length === 0) {
    console.log("No failed rows to reset.");
    return;
  }

  const queueIds = failedRows.map(r => r.id);
  console.log(`Found ${queueIds.length} failed rows. Resetting via ledger insertion...`);

  // 2. Insert into oci_queue_transitions to trigger the snapshot update
  const transitions = queueIds.map(id => ({
    queue_id: id,
    new_status: 'QUEUED',
    actor: 'SYSTEM_BACKFILL',
    error_payload: { clear_fields: ['last_error', 'provider_error_code', 'provider_error_category', 'claimed_at'] }
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('oci_queue_transitions')
    .insert(transitions)
    .select('id');

  if (insertError) {
    console.error("Error resetting failures via ledger:", insertError);
  } else {
    console.log(`Successfully inserted ${inserted?.length ?? 0} reset transitions into ledger. Target rows should now be QUEUED.`);
  }
}

async function main() {
  await fixOciConfigs();
  await resetFailedConversions();
  console.log("\n--- Fix Complete ---");
}

main().catch(console.error);
