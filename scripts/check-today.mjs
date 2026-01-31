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

async function checkToday() {
    const { data: sites } = await supabase.from('sites').select('*');
    if (!sites) return;

    const today = new Date().toISOString().split('T')[0];
    const from = `${today}T00:00:00Z`;
    const to = `${today}T23:59:59Z`;

    console.log(`Checking stats for ${today}`);

    for (const site of sites) {
        const { data: stats } = await supabase.rpc('get_command_center_p0_stats_v2', {
            p_site_id: site.id,
            p_date_from: from,
            p_date_to: to,
            p_ads_only: true
        });

        console.log(`Site: ${site.name || 'null'} | Pending: ${stats?.queue_pending || 0} | Sealed: ${stats?.sealed || 0}`);
    }
}

checkToday();
