import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

/** Site display name — set CHECK_INTENTS_SITE_NAME or pass as first CLI arg */
const siteName = process.env.CHECK_INTENTS_SITE_NAME || process.argv[2];
if (!siteName) {
  console.error('Usage: CHECK_INTENTS_SITE_NAME="Site Name" node scripts/check-intents.mjs');
  console.error('   or: node scripts/check-intents.mjs "Site Name"');
  process.exit(1);
}

async function checkIntents() {
    const { data: sites } = await supabase.from('sites').select('*').eq('name', siteName);
    if (!sites || sites.length === 0) {
        console.error(`No site found with name: ${siteName}`);
        process.exit(1);
    }
    const site = sites[0];

    const today = new Date().toISOString().split('T')[0];
    const from = `${today}T00:00:00Z`;
    const to = `${today}T23:59:59Z`;

    const { data: intents, error } = await supabase.rpc('get_recent_intents_v2', {
        p_site_id: site.id,
        p_date_from: from,
        p_date_to: to,
        p_limit: 10,
        p_ads_only: true
    });

    if (error) {
        console.error('[check-intents] RPC error:', {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
        });
        process.exitCode = 1;
        return;
    }

    console.log(`Intents for ${site.name}:`, intents?.length || 0);
    if (intents && intents.length > 0) {
        intents.forEach(it => {
            console.log(`- ID: ${it.id} | Action: ${it.intent_action} | GCLID: ${it.gclid || 'NULL'}`);
        });
    }
}

checkIntents();
