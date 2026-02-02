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

async function checkIntents() {
    const { data: sites } = await supabase.from('sites').select('*').eq('name', 'Gümüş Alanlar');
    if (!sites || sites.length === 0) return;
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
